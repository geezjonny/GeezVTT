export const SCENE_AUDIO_CHANNELS = ['ambience','music'];

export function sceneAudio(raw) {
  return Object.fromEntries(SCENE_AUDIO_CHANNELS.map(name=>{
    const value=raw?.[name];
    let url='';
    try {
      const parsed=new URL(value?.url);
      if(['http:','https:'].includes(parsed.protocol) && parsed.href.length<=2048) url=parsed.href;
    } catch { /* Missing or invalid tracks stay stopped. */ }
    return [name,{url,volume:Number.isFinite(value?.volume) && value.volume>=0 && value.volume<=1?value.volume:1,stopped:!url || value?.stopped!==false}];
  }));
}
