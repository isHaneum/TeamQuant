import {createHoldingsRecord,createFailureRecord} from './history-model.js';

// This adapter never includes raw account references, client IDs or file paths in responses.
export function createHistoryRecorder({store,now=()=>new Date().toISOString()}){
  return {
    async snapshot(data,context){try{const accountId=await store.accountId(context);const result=await store.append(createHoldingsRecord(data,{accountId,recordedAt:now()}));return {saved:true,scope:'holdings_only',snapshotId:result.record.id,recordedAt:result.record.recordedAt};}catch{return {saved:false,scope:'holdings_only',code:'local_history_unavailable'};}},
    async failure(error,context={}){try{const accountId=context.clientId&&context.accountRef?await store.accountId(context):null;await store.append(createFailureRecord({accountId,observedAt:now(),errorCode:error.code},now()));return true;}catch{return false;}}
  };
}
