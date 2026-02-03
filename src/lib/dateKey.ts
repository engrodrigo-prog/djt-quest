export const extractYyyyMmDd = (value: string | null | undefined) => {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
};

export const isYyyyMmDd = (value: string | null | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

