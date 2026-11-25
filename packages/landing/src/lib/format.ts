export const formatPostDate = (date: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(date);
  if (!match) return date;
  const [, year, month, day, hour, minute] = match;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthName = months[Number(month) - 1] ?? month;
  const base = `${Number(day)} ${monthName} ${year}`;
  return hour ? `${base}, ${hour}:${minute}` : base;
};
