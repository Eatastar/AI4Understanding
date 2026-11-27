import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadReaderAppearance, saveReaderAppearance } from '../adapters/reader';
import { desktop } from '../adapters/desktop';
import { colorLuminance, readerTheme } from '../domain/reader';

export function useReaderAppearance() {
  const [appearance, setAppearance] = useState(loadReaderAppearance);
  const [saved, setSaved] = useState(true);
  const latest = useRef(appearance);
  latest.current = appearance;
  const { paper, ink } = appearance;
  const scheme = colorLuminance(paper) < .179 ? 'dark' : 'light';
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(readerTheme(paper, ink))) style.setProperty(name, value);
    style.colorScheme = scheme;
  }, [paper, ink, scheme]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSaved(saveReaderAppearance(appearance));
      desktop()?.setTheme?.({ paper, scheme });
    }, 180);
    return () => clearTimeout(timer);
  }, [appearance, paper, scheme]);
  useEffect(() => {
    const save = () => { setSaved(saveReaderAppearance(latest.current)); };
    document.addEventListener('learn:save-edits', save);
    window.addEventListener('pagehide', save);
    return () => {
      saveReaderAppearance(latest.current);
      document.removeEventListener('learn:save-edits', save);
      window.removeEventListener('pagehide', save);
    };
  }, []);
  return { appearance, setAppearance, saved };
}
