import test from 'node:test';
import assert from 'node:assert/strict';
import {accountView} from '../lib/account-view.js';
test('account home cannot replace unavailable, loading or wrong-profile holdings with demo/paper money',()=>{
 for(const status of ['idle','loading','error'])assert.deepEqual(accountView('alice',null,status),{mode:'pending',connected:false,status});
 assert.equal(accountView('bob',{owner:'alice',snapshot:{positions:[]}}).connected,false);
 assert.equal(accountView(null,{owner:null,snapshot:{positions:[]}}).connected,false);
});
test('successful empty account stays real and KIS/Toss sources remain distinct',()=>{
 assert.equal(accountView('alice',{owner:'alice',snapshot:{positions:[]}}).mode,'broker_holdings');
 assert.equal(accountView('alice',{owner:'alice',portfolio:{positions:[]}}).mode,'account');
});
