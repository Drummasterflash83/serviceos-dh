import copy
from datetime import datetime, timezone, timedelta
import html
import unittest
from plan_commusoft_customers import plan

NOW = datetime(2026, 10, 13, 18, 30, tzinfo=timezone.utc)
def uid(n): return f'cf810000-aaaa-4000-8000-{n:012d}'
def export(rows):
    header = ['Account no','Name','Address line 1','Address line 2','Postcode','Telephone','Email']
    return ('<table>' + ''.join('<tr>' + ''.join('<td>'+html.escape(str(v))+'</td>' for v in row)+'</tr>' for row in [header]+rows) + '</table>').encode()
def account(identifier='101', label='Ms Alice Able', postcode='AB1 2CD', email='alice@example.invalid', phone=''):
    return [identifier,label,'1 Test Road','',postcode,phone,email]
def source(identifier='101', firstname='Alice', lastname='Able', category=1, postcode='AB1 2CD'):
    return {'externalId':identifier,'versionId':uid(int(identifier)), 'observedAt':NOW.isoformat(), 'payload':{'id':int(identifier),'type':'customer','customerType':category,'postcode':postcode,'contact':{'firstName':firstname,'lastName':lastname,'email':'alice@example.invalid'}}}
def snapshot():
    return {'scope':{'tenant':uid(1),'connection':uid(2),'observedAt':NOW.isoformat()},'customers':[source()], 'existing':[], 'contactPoints':[], 'links':[], 'relationships':[]}
def mapping(): return {'tenant':uid(1),'connection':uid(2),'evidence':'Synthetic reviewed categories', 'categories':{'1':'person','2':'company','14':'hold'}}

class ReviewPlan(unittest.TestCase):
    def build(self, s=None, rows=None, m=None): return plan(s or snapshot(), export(rows or [account()]), m or mapping(), NOW)
    def reasons(self,p): return p['records'][0]['reasons']
    def test_person_export_title_is_corroboration_not_a_merge(self):
        p=self.build();r=p['batches'][0][0]
        self.assertEqual(r['identity']['displayName'],'Alice Able')
        self.assertTrue(r['identity']['contactIsCustomer'])
        self.assertEqual(p['summary']['applied'],0)
        self.assertIn(p['exportSha256'],r['identity']['evidence'])
        s=snapshot();s['customers'][0]['payload']['contact']['lastName']='van  Able'
        p=self.build(s,[account(label='Alice van Able')])
        self.assertEqual(p['batches'][0][0]['identity']['displayName'],'Alice van  Able')
    def test_primary_contact_different_from_holder_is_held(self):
        self.assertIn('account_holder_differs_or_uncertain', self.reasons(self.build(rows=[account(label='Ms Landlord Account')])) )
    def test_company_requires_tenant_classification_and_export_name(self):
        s=snapshot();s['customers'][0]['payload'].update(customerType=2,companyName='Example & Co')
        p=self.build(s,[account(label='Example & Co')]);self.assertEqual(len(p['batches']),1);self.assertNotIn('identity',p['batches'][0][0])
        self.assertIn('company_name_not_corroborated',self.reasons(self.build(s,[account(label='Other Co')])))
    def test_missing_or_mismatched_postcode_is_held(self):
        for value in ['', 'ZZ1 1ZZ']:
            self.assertIn('account_postcode_not_corroborated',self.reasons(self.build(rows=[account(postcode=value)])))
    def test_unknown_or_internal_category_held(self):
        for category in [14,99]:
            s=snapshot();s['customers'][0]['payload']['customerType']=category
            self.assertIn('category_needs_review',self.reasons(self.build(s)))
    def test_company_name_on_person_category_is_not_ignored(self):
        s=snapshot();s['customers'][0]['payload']['companyName']='Example Co'
        self.assertIn('person_category_has_company_name',self.reasons(self.build(s)))
    def test_existing_name_postcode_endpoint_only_suggests_review(self):
        for data in [{'name':'Alice Able'},{'postcode':'ab12cd'},{'email':'ALICE@example.invalid'}]:
            s=snapshot();s['existing']=[dict(id=uid(7),kind='person',**data)]
            p=self.build(s);self.assertIn('existing_identity_candidates',self.reasons(p));self.assertFalse(p['batches'])
    def test_additional_contact_point_detects_existing_person(self):
        s=snapshot();s['existing']=[{'id':uid(7),'kind':'person','name':'Different stored name'}]
        s['contactPoints']=[{'personId':uid(7),'channel':'email','value':'alice@example.invalid'}]
        self.assertIn('existing_identity_candidates',self.reasons(self.build(s)))
    def test_shared_phone_is_a_collision_not_identity(self):
        s=snapshot();s['existing']=[{'id':uid(7),'kind':'person','name':'Reception','phone':'+44 7700 900123'}]
        self.assertIn('existing_identity_candidates',self.reasons(self.build(s,[account(phone='07700900123')])))
    def test_two_new_accounts_cannot_avoid_collision_check(self):
        s=snapshot();s['customers'].append(source('102','Bob','Baker'));s['customers'][1]['payload']['contact']['email']='bob@example.invalid'
        p=self.build(s,[account(phone='07700900123'),account('102','Bob Baker','BB1 1BB','bob@example.invalid','07700900123')])
        self.assertTrue(all('other_account_candidates' in r['reasons'] for r in p['records']))
    def test_duplicate_export_and_ambiguous_latest_are_held(self):
        self.assertIn('export_missing_or_duplicate',self.reasons(self.build(rows=[account(),account()])))
        s=snapshot();s['customers'].append(copy.deepcopy(s['customers'][0]));s['customers'][1]['versionId']=uid(103)
        self.assertIn('ambiguous_latest_source',self.reasons(self.build(s)))
    def test_export_only_records_are_counted_not_published(self):
        p=self.build(rows=[account(),account('102','Bob Baker')])
        self.assertEqual(p['summary']['reasons']['not_in_retained_api_sources'],1)
    def test_linked_updated_source_is_not_new_identity(self):
        s=snapshot();s['links']=[{'externalId':'101','versionId':uid(101),'id':uid(7)}];s['existing']=[{'id':uid(7),'kind':'person','name':'Alice Able','postcode':'AB1 2CD'}]
        self.assertEqual(self.build(s)['records'][0]['state'],'linked')
        self.assertEqual(self.build(s,[account(label='Different Account')])['records'][0]['state'],'linked_account_needs_review')
        s['links'][0]['versionId']=uid(102)
        self.assertEqual(self.build(s)['records'][0]['state'],'linked_source_needs_review')
    def test_scope_and_freshness_fail_closed(self):
        m=mapping();m['tenant']=uid(3)
        with self.assertRaises(ValueError):self.build(m=m)
        for offset in [-3601, 61]:
            s=snapshot();s['scope']['observedAt']=(NOW+timedelta(seconds=offset)).isoformat()
            with self.assertRaises(ValueError):self.build(s)
    def test_source_identity_is_checked(self):
        for value in [True,'101',102,9007199254740992]:
            s=snapshot();s['customers'][0]['payload']['id']=value
            self.assertIn('source_identity_invalid',self.reasons(self.build(s)))
    def test_dependency_counts_do_not_choose_ambiguous_relationships(self):
        s=snapshot();s['relationships']=[{'kind':'site','externalId':'201','parentId':'101'},{'kind':'job','externalId':'301','parentId':'201'},{'kind':'job','externalId':'302','parentId':'101'},{'kind':'job','externalId':'303','parentId':'101'},{'kind':'job','externalId':'303','parentId':'102'}]
        p=self.build(s);self.assertEqual(p['records'][0]['dependencies'],{'sites':1,'directJobs':1,'siteJobs':1});self.assertEqual(p['summary']['ambiguousRelationships'],1)
    def test_malformed_export_and_out_of_scope_contact_points_refused(self):
        with self.assertRaises(ValueError):plan(snapshot(),b'<table><tr><td>Unknown</td></tr></table>',mapping(),NOW)
        s=snapshot();s['contactPoints']=[{'personId':uid(9),'channel':'email','value':'unknown@example.invalid'}]
        with self.assertRaises(ValueError):self.build(s)
    def test_batch_bound_and_input_immutability(self):
        s=snapshot();s['customers']=[];rows=[]
        for i in range(101,144):
            r=source(str(i),f'Person{i}','Example');r['payload']['contact']['email']=f'p{i}@example.invalid';s['customers'].append(r)
            rows.append(account(str(i),f'Person{i} Example',email=f'p{i}@example.invalid'))
        before=copy.deepcopy(s);p=self.build(s,rows)
        self.assertEqual([len(b) for b in p['batches']],[20,20,3]);self.assertEqual(before,s)

if __name__ == '__main__':unittest.main()
