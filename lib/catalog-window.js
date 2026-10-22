const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// DSH's stock skill tool publishes the entire registry after it is selected.
// Keep that registry and its durable identity intact, but bound this library's
// model-facing summaries through the public pre-step middleware hook.
export function windowLocalCatalog(decision, localEntries, query = '') {
  if (decision.kind === 'reject' || !decision.messages) return decision;
  const words = [...new Set(query.toLowerCase().split(/\W+/).filter(word => word.length > 2))];
  return {...decision, messages: decision.messages.map(message => {
    const entries = message.source?.kind === 'skill-catalog' && message.source.entries;
    if (!Array.isArray(entries) || !entries.some(row => localEntries.has(row.name))) return message;
    const ranked = entries.filter(row => localEntries.has(row.name)).map(row => {
      const local = localEntries.get(row.name);
      const text = `${row.name} ${row.description} ${local.repo}`.toLowerCase();
      const score = words.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0);
      return {row, score};
    }).filter(item => !words.length || item.score).sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
    const shortlist = []; let chars = 0;
    for (const {row} of ranked.slice(0, 24)) {
      const line = `- \`${row.name}\`: ${escape(row.description.slice(0, 320))}`;
      if (chars + line.length > 12000) break;
      shortlist.push(line); chars += line.length;
    }
    const other = entries.filter(row => !localEntries.has(row.name)).map(row => `- \`${row.name}\`: ${escape(row.description)}`);
    const text = ['<system-reminder>', 'Available skill summaries for this task:', '<available_skills>', ...other, ...shortlist, '</available_skills>',
      'The local VoltAgent/Story Skills library is larger than this shortlist. Use voltagent_skills to search it and load any exact returned name with the skill tool. browse_tools can also discover all registered skills. These are summaries only; read a skill before following its instructions. User instructions take priority.', '</system-reminder>'].join('\n');
    return {...message, content: [{type: 'text', text}]};
  })};
}
