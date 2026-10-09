/** Bounded header metadata only; recognition is not an audio decode. A WAV data
 * chunk may occur beyond this prefix, so absent fields mean unknown, never zero. */
export function inspectAudioHeader(prefix) {
  const ascii=(at,length)=>String.fromCharCode(...prefix.subarray(at,at+length));
  const format=ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE'?'wav':ascii(0,4)==='OggS'?'ogg':ascii(0,4)==='fLaC'?'flac':ascii(0,3)==='ID3'||prefix.length>=2&&prefix[0]===255&&(prefix[1]&224)===224?'mp3':ascii(4,4)==='ftyp'?'mp4':null;
  const view=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength);
  const declaredBytes=format==='wav'?view.getUint32(4,true)+8:null;
  let wav=null;
  if(format==='wav'){
    wav={};
    for(let at=12;at+8<=prefix.length;){
      const kind=ascii(at,4),size=view.getUint32(at+4,true);
      if(kind==='fmt '&&size>=16&&at+24<=prefix.length)Object.assign(wav,{
        format_tag:view.getUint16(at+8,true),channels:view.getUint16(at+10,true),
        sample_rate:view.getUint32(at+12,true),byte_rate:view.getUint32(at+16,true),
        bits_per_sample:view.getUint16(at+22,true),
      });
      if(kind==='data')wav.data_bytes=size;
      at+=8+size+(size%2);
    }
  }
  return {status:format?'recognised_audio_header':'unrecognised_header',format,wav,prefix_bytes:prefix.length,declared_wav_bytes:declaredBytes};
}
