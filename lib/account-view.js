// The asset home never substitutes a paper balance for an unavailable account.
export function accountView(owner,live,status='idle'){
 if(!owner||!live||live.owner!==owner)return {mode:'pending',connected:false,status};
 return {mode:live.snapshot?'broker_holdings':'account',connected:true,status};
}
