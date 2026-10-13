"""Read-only customer reconciliation: no API calls, writes, merges or approvals.

An account export corroborates retained sources. Tenant-specific category mapping
is explicit input. Candidate batches remain proposals for logged operator review.
Private input and output must never be committed to Git.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import uuid


def text(value):
    return ' '.join(value.split()) if isinstance(value, str) else ''


def name(value):
    return text(value).casefold()


def person_name(value):
    # Used only for corroboration/collision detection, never an automatic merge.
    return re.sub(r'^(mr|mrs|ms|miss|dr|prof|sir|rev)\.?\s+', '', name(value))


def postcode(value):
    return re.sub(r'\s+', '', text(value)).casefold()


def phone(value):
    # A deliberately broad collision key, not a verified telephone identity.
    digits = re.sub(r'\D', '', text(value))
    return digits[-10:] if len(digits) >= 10 else digits


def valid_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except (ValueError, AttributeError):
        return False


class CustomerExport(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            if self.row is not None:
                raise ValueError('Nested export row')
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            if self.cell is not None:
                raise ValueError('Nested export cell')
            self.cell = []
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_data(self, value):
        if self.cell is not None:
            self.cell.append(value)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(text(''.join(self.cell)))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if self.cell is not None:
                raise ValueError('Unclosed export cell')
            self.rows.append(self.row)
            self.row = None


def read_export(raw):
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError('Export exceeds review bound')
    parser = CustomerExport()
    parser.feed(raw.decode('utf-8-sig'))
    parser.close()
    header = ['Account no', 'Name', 'Address line 1', 'Address line 2', 'Postcode', 'Telephone', 'Email']
    positions = [i for i, row in enumerate(parser.rows) if row == header]
    if len(positions) != 1 or parser.row is not None or parser.cell is not None:
        raise ValueError('Expected one complete customer export table')
    rows = parser.rows[positions[0] + 1:]
    if not rows or len(rows) > 100000:
        raise ValueError('Empty or oversized export')
    result = defaultdict(list)
    for number, row in enumerate(rows, positions[0] + 2):
        if len(row) != 7 or not re.fullmatch(r'[1-9][0-9]{0,15}', row[0]) or not row[1]:
            raise ValueError('Malformed customer export row')
        result[row[0]].append(dict(zip(['externalId', 'name', 'address1', 'address2', 'postcode', 'phone', 'email'], row), row=number))
    return result, hashlib.sha256(raw).hexdigest()


def plan(snapshot, export_raw, mapping, now=None):
    scope = snapshot.get('scope', {})
    if not all(valid_uuid(scope.get(k)) for k in ('tenant', 'connection')):
        raise ValueError('Invalid snapshot scope')
    if any(mapping.get(k) != scope[k] for k in ('tenant', 'connection')) or len(text(mapping.get('evidence'))) < 3:
        raise ValueError('Category mapping must identify the same tenant and connection with evidence')
    categories = mapping.get('categories')
    if not isinstance(categories, dict) or not categories or any(v not in ('person', 'company', 'hold') for v in categories.values()):
        raise ValueError('Explicit reviewed category mapping required')
    observed = datetime.fromisoformat(scope['observedAt'].replace('Z', '+00:00'))
    now = now or datetime.now(timezone.utc)
    if observed.tzinfo is None or not -60 <= (now - observed).total_seconds() <= 3600:
        raise ValueError('Snapshot must be from the last hour; refresh before review')
    exports, export_hash = read_export(export_raw)
    for key in ('customers', 'existing', 'contactPoints', 'links', 'relationships'):
        if not isinstance(snapshot.get(key), list):
            raise ValueError('Incomplete snapshot: ' + key)
    indexes = {k: defaultdict(set) for k in ('name', 'email', 'phone', 'postcode')}
    entities = {}
    for entity in snapshot['existing']:
        if not valid_uuid(entity.get('id')) or entity.get('kind') not in ('person', 'company'):
            raise ValueError('Invalid existing identity')
        if entity['id'] in entities:
            raise ValueError('Duplicate existing identity')
        entities[entity['id']] = entity
        for key, value in (('name', person_name(entity.get('name'))), ('email', name(entity.get('email'))), ('phone', phone(entity.get('phone'))), ('postcode', postcode(entity.get('postcode')))):
            if value:
                indexes[key][value].add(entity['id'])
    for point in snapshot['contactPoints']:
        if point.get('personId') not in entities or point.get('channel') not in ('email', 'phone'):
            raise ValueError('Contact point outside supplied identity scope')
        key = point['channel']
        value = (phone if key == 'phone' else name)(point.get('value'))
        if value:
            indexes[key][value].add(point['personId'])
    sources, links = defaultdict(list), defaultdict(list)
    for source in snapshot['customers']:
        if not re.fullmatch(r'[1-9][0-9]{0,15}', str(source.get('externalId', ''))) or not valid_uuid(source.get('versionId')) or not isinstance(source.get('payload'), dict):
            raise ValueError('Invalid retained source')
        sources[source['externalId']].append(source)
    for link in snapshot['links']:
        links[link['externalId']].append(link)
    # Repeated latest relationship versions are ambiguous, not silently counted once.
    relation_rows = defaultdict(list)
    for r in snapshot['relationships']:
        if r.get('kind') not in ('site', 'job'):
            raise ValueError('Unknown relationship kind')
        relation_rows[(r['kind'], r['externalId'])].append(r)
    sites, jobs = defaultdict(list), defaultdict(list)
    ambiguous_relations = 0
    for (kind, identifier), values in relation_rows.items():
        if len(values) != 1:
            ambiguous_relations += 1
            continue
        (sites if kind == 'site' else jobs)[values[0].get('parentId')].append(identifier)
    # Two unlinked accounts may collide with each other even when neither yet
    # exists canonically. Do not propose both as independent new identities.
    account_index = {key: defaultdict(set) for key in ('name', 'email', 'phone')}
    for account_id, rows in exports.items():
        for account in rows:
            for key, value in (('name', person_name(account['name'])), ('email', name(account['email'])), ('phone', phone(account['phone']))):
                if value:
                    account_index[key][value].add(account_id)
    results = []
    for identifier, versions in sorted(sources.items(), key=lambda x: int(x[0]), reverse=True):
        reasons = []
        entry = {'externalId': identifier, 'state': 'held', 'reasons': reasons}
        results.append(entry)
        if len(versions) != 1:
            reasons.append('ambiguous_latest_source')
            continue
        source = versions[0]
        raw = source['payload']
        entry['versionId'] = source['versionId']
        if type(raw.get('id')) is not int or not 0 < raw['id'] <= 9007199254740991 or str(raw['id']) != identifier or raw.get('type') != 'customer':
            reasons.append('source_identity_invalid')
            continue
        if links[identifier]:
            entry['state'] = 'linked_source_needs_review'
            if len(links[identifier]) == 1 and links[identifier][0]['versionId'] == source['versionId']:
                known = entities.get(links[identifier][0].get('id'))
                exported = exports.get(identifier, [])
                entry['state'] = 'linked_account_needs_review'
                if known and len(exported) == 1:
                    normalize = person_name if known['kind'] == 'person' else name
                    if (normalize(known.get('name')) == normalize(exported[0]['name'])
                            and postcode(exported[0]['postcode'])
                            and postcode(known.get('postcode')) == postcode(exported[0]['postcode'])):
                        entry['state'] = 'linked'
            continue
        export_rows = exports.get(identifier, [])
        if len(export_rows) != 1:
            reasons.append('export_missing_or_duplicate')
            continue
        account = export_rows[0]
        entry['accountName'] = account['name']
        entry['exportRow'] = account['row']
        category = str(raw.get('customerType', ''))
        kind = categories.get(category, 'hold')
        entry['kind'] = kind
        if kind == 'hold':
            reasons.append('category_needs_review')
        if not postcode(account['postcode']) or postcode(account['postcode']) != postcode(raw.get('postcode')):
            reasons.append('account_postcode_not_corroborated')
        contact = raw.get('contact') or {}
        if not isinstance(contact, dict):
            reasons.append('contact_shape_invalid')
            contact = {}
        # Match the installed writer's trimmed first/last-name join exactly.
        # Corroboration may normalize whitespace; the submitted label must not.
        primary_name = ' '.join(contact[k].strip() for k in ('firstName', 'lastName') if isinstance(contact.get(k), str) and contact[k].strip())
        company_name = text(raw.get('companyName'))
        if kind == 'person':
            if company_name:
                reasons.append('person_category_has_company_name')
            if not primary_name or person_name(primary_name) != person_name(account['name']):
                reasons.append('account_holder_differs_or_uncertain')
            else:
                entry['identity'] = {'displayName': primary_name, 'contactIsCustomer': True,
                    'evidence': f"Customer export SHA-256 {export_hash}, row {account['row']}, account {identifier}: account name and postcode corroborate retained primary contact. Export account name: {account['name']}"}
        elif kind == 'company' and (not company_name or name(company_name) != name(account['name'])):
            reasons.append('company_name_not_corroborated')
        matches = defaultdict(set)
        candidates = [('name', person_name(account['name'])), ('name', person_name(primary_name)), ('name', person_name(company_name)), ('postcode', postcode(account['postcode']))]
        candidates += [('email', name(v)) for v in (account['email'], contact.get('email'))]
        candidates += [('phone', phone(v)) for v in (account['phone'], contact.get('telephone'), contact.get('mobile'))]
        other_accounts = set()
        for key, value in candidates:
            if key in account_index and value:
                other_accounts.update(account_index[key].get(value, set()) - {identifier})
        if other_accounts:
            reasons.append('other_account_candidates')
            entry['otherAccounts'] = sorted(other_accounts, key=int)
        for key, value in candidates:
            if value:
                for target in indexes[key].get(value, ()):
                    matches[target].add(key)
        if matches:
            reasons.append('existing_identity_candidates')
            entry['candidates'] = [{'id': target, 'kind': entities[target]['kind'], 'reasons': sorted(why)} for target, why in sorted(matches.items())]
        entry['dependencies'] = {'sites': len(sites[identifier]), 'directJobs': len(jobs[identifier]), 'siteJobs': sum(len(jobs[s]) for s in sites[identifier])}
        if not reasons:
            entry['state'] = 'ready_for_operator_review'
    # An export-only customer cannot be published as if the API had captured it.
    for identifier in sorted(set(exports) - set(sources), key=int):
        results.append({'externalId': identifier, 'state': 'held', 'reasons': ['not_in_retained_api_sources']})
    ready = [r for r in results if r['state'] == 'ready_for_operator_review']
    return {'version': 'commusoft-customer-reconciliation/1', 'scope': scope, 'exportSha256': export_hash,
        'mappingEvidence': mapping['evidence'], 'mappingSha256': hashlib.sha256(json.dumps(mapping, sort_keys=True).encode()).hexdigest(),
        'summary': {'sources': len(sources), 'exportAccounts': len(exports), 'states': dict(Counter(r['state'] for r in results)),
            'reasons': dict(Counter(reason for r in results for reason in r['reasons'])), 'ambiguousRelationships': ambiguous_relations,
            'reviewBatches': (len(ready) + 19) // 20, 'applied': 0},
        'batches': [ready[i:i + 20] for i in range(0, len(ready), 20)], 'records': results,
        'limitations': ['Proposals only; no identity is approved, merged or created.', 'Existing identity suggestions require logged review; a shared name, postcode or endpoint is not proof.', 'Recheck current source, identity candidates and operator authority before each save.', 'Counts describe this snapshot, not complete provider coverage.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--export-source', required=True)
    parser.add_argument('--mapping', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    destination = Path(args.output).resolve()
    if destination.exists() or not any(destination.is_relative_to(p) for p in (Path('/private/tmp'), Path('/tmp').resolve(), Path('.verification-results').resolve())):
        raise ValueError('Choose a new private output under /private/tmp or .verification-results')
    report = plan(json.loads(Path(args.snapshot).read_text()), Path(args.export_source).read_bytes(), json.loads(Path(args.mapping).read_text()))
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump(report, handle, indent=2)
        handle.write('\n')
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
