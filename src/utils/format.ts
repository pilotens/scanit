export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
