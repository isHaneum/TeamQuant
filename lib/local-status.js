import {stat} from 'node:fs/promises';

// Report availability only. Never return key contents, filenames or paths.
export async function localStatus(env=process.env){
 let keyFile='not_configured';
 if(env.TOSS_KEY_FILE){try{keyFile=(await stat(env.TOSS_KEY_FILE)).isFile()?'ready':'missing';}catch{keyFile='missing';}}
 return {service:'teamquant-local',schemaVersion:1,keyFile};
}
