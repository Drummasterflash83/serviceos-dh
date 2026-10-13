"""Pure metadata relationship checks; never reads source bytes or credentials."""

def expected_pair(entries):
    if len(entries) != 2:
        raise ValueError('pair_scope_invalid')
    by = {e['sourceBucket']: e for e in entries}
    raw, audio = by['learn-voicemail-sources'], by['receptionist-voicemails']
    r, a = raw['sourceKey'].split('/'), audio['sourceKey'].split('/')
    if (len(r) != 3 or len(a) != 3 or r[0] != a[0]
        or r[0] != raw['tenantId'] or r[0] != audio['tenantId']
        or r[1] != a[2] or not r[2].endswith('.eml')
        or raw['recordingIds'] != [r[2][:-4]] or audio['recordingIds'] != [a[2]]):
        raise ValueError('pair_binding_invalid')
    return {'tenant': a[0], 'intake': a[2], 'mailbox': a[1], 'source': r[2][:-4],
            'raw': raw, 'audio': audio}


def compare_relationships(pair, rows):
    required = ('intake', 'source', 'voicemail', 'rawStorage', 'audioStorage')
    missing = [k for k in required if rows.get(k) is None]
    if missing:
        return {'state': 'database_relationships_absent', 'missing': missing,
                'databaseRecoveryVerified': False}
    i, s, v = (rows[k] for k in required[:3])
    checks = {
        'intake': all(i.get(k) == val for k, val in {
            'id':pair['intake'],'tenant_id':pair['tenant'],'mailbox_id':pair['mailbox'],
            'state':'published','audio_sha256':pair['audio']['sourceContentSha256'],
            'audio_bytes':pair['audio']['size']}.items()),
        'source': all(s.get(k) == val for k, val in {
            'id':pair['source'],'tenant_id':pair['tenant'],'intake_id':pair['intake'],
            'raw_sha256':pair['raw']['sourceContentSha256'],'raw_bytes':pair['raw']['size']}.items()),
        'voicemail': all(v.get(k) == val for k, val in {
            'id':pair['intake'],'tenant_id':pair['tenant'],'mailbox_id':pair['mailbox'],
            'recording_path':pair['audio']['sourceKey']}.items())}
    for label, entry in [('rawStorage', pair['raw']), ('audioStorage', pair['audio'])]:
        checks[label] = all(rows[label].get(k) == val for k, val in {
            'id':entry['objectId'],'bucket_id':entry['sourceBucket'],'name':entry['sourceKey']}.items())
    return {'state':'database_relationships_verified' if all(checks.values()) else 'database_relationships_mismatch',
            'checks':checks, 'databaseRecoveryVerified':all(checks.values())}


def compare_restore_receipt(pair, receipt):
    if receipt is None:
        return {'state':'paired_restore_pending','filesVerified':False,'decoded':False,'listening':'not_verified'}
    if (receipt.get('state') != 'independent_pair_restored_and_verified'
        or receipt.get('sourceAccessDuringRestore') is not False
        or receipt.get('privateContentRemoved') is not True or len(receipt.get('proofs',[])) != 2):
        raise ValueError('restore_receipt_unverified')
    for label in ('raw','audio'):
        e=pair[label]; proofs=[p for p in receipt['proofs'] if p.get('sourceBucket')==e['sourceBucket']]
        if len(proofs)!=1 or any(proofs[0].get(k)!=v for k,v in {
            'objectId':e['objectId'],'bytes':e['size'],'sha256':e['sourceContentSha256']}.items()):
            raise ValueError('restore_receipt_binding_changed')
        if label=='audio':
            p=proofs[0].get('playback') or {}
            if p.get('state')!='decoded' or p.get('frames',0)<=0 or p.get('sampleRate',0)<=0 or p.get('durationSeconds',0)<=0:
                raise ValueError('restored_audio_decode_unverified')
    return {'state':'independent_files_verified','filesVerified':True,'decoded':True,
            'durationSeconds':p['durationSeconds'],'listening':'not_verified'}
