import { t } from '../i18n/locale';
import { useState } from 'react';
import { MAX_INPUT_CAP } from '../../shared/reader-budget.mjs';
import { readReaderOptions, saveReaderOptions, type ReaderOptions } from '../adapters/reader-policy';

export function ReaderEngineOptions({options,onChange}:{options:ReaderOptions;onChange:(o:ReaderOptions)=>void}) {
  const [input,setInput]=useState(String(options.inputCap));
  const [money,setMoney]=useState(options.maxUSD?.toString()??'');
  const [error,setError]=useState('');
  const save=(o:ReaderOptions)=>{
    try { saveReaderOptions(o); onChange(readReaderOptions()); setError(''); }
    catch {setError('阅读设置未能保存。');}
  };
  return <>
    <label className="reader-setting-row">{t('划词问答使用上下文引擎')}<input type="checkbox" checked={options.enabled} onChange={e=>save({...options,enabled:e.target.checked})}/></label>
    {options.enabled && <>
      <label className="reader-setting-row">{t('输入上限（估算 tokens）')}<input type="number" min={256} max={MAX_INPUT_CAP} value={input} onChange={e=>setInput(e.target.value)} onBlur={()=>{
        const n=Number(input); if (!Number.isSafeInteger(n)||n<256||n>MAX_INPUT_CAP) {setError('输入上限范围为 256–200,000 tokens。');setInput(String(options.inputCap));return;} save({...options,inputCap:n});
      }}/></label>
      <label className="reader-setting-row">{t('单题费用上限（美元）')}<input type="number" min="0.000001" step="any" placeholder="可选" value={money} onChange={e=>setMoney(e.target.value)} onBlur={()=>{
        const n=money.trim()?Number(money):undefined; if (n!==undefined && (!Number.isFinite(n)||n<=0)){setError('金额须大于零。');setMoney(options.maxUSD?.toString()??'');return;} save({...options,maxUSD:n});
      }}/></label>
    </>}
    {error && <p role="alert" className="reader-settings-help">{t(error)}</p>}
  </>;
}
