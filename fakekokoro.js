export class KokoroTTS{
  static async from_pretrained(id,o){const cb=o.progress_callback;cb({status:'initiate',file:'onnx/model_quantized.onnx'});
    for(let i=1;i<=5;i++){cb({status:'progress',file:'onnx/model_quantized.onnx',loaded:i*18e6,total:90e6,progress:i*20});await new Promise(r=>setTimeout(r,60));}
    cb({status:'done',file:'onnx/model_quantized.onnx'});return new KokoroTTS();}
  async generate(text,{voice,speed}){const n=Math.max(2400,Math.round(text.length/15/25*24000)),a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=.02*Math.sin(i*.05);self.__voices=(self.__voices||[]);return {audio:a,sampling_rate:24000};}
}
