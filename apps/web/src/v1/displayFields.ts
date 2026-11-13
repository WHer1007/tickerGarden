/** Keep historical executions distinguishable from today's trades. */
export function tradeTimestamp(timestamp: number, now = new Date()): {label: string; title: string} {
 const date = new Date(timestamp * 1000);
 const sameDay = date.toDateString() === now.toDateString();
 const time = date.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
 const day = date.toLocaleDateString('en-GB', {day: '2-digit', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? {year: 'numeric' as const} : {})});
 return {label: sameDay ? time : `${day} ${time}`, title: date.toISOString()};
}
