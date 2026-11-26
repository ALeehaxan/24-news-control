const thaana = /[\u0780-\u07a5]/u;

export function sourceLanguage(text) {
  return thaana.test(text) ? 'dv' : 'en';
}

export function pastedExcerpts(text) {
  const normalized = text.trim().replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sentences = paragraphs.flatMap(paragraph =>
    paragraph.match(/[^!?؟.]+[!?؟.]+(?=\s|$)|.+$/gu) || [paragraph]);
  const usable = [...new Set(sentences.map(sentence => sentence.trim()).filter(sentence => sentence.length >= 40))];
  const excerpts = [];
  let remaining = 480;
  for (const sentence of usable.slice(0, Math.max(2, usable.length - 1))) {
    if (sentence.length > remaining) continue;
    excerpts.push(sentence);
    remaining -= sentence.length;
    if (excerpts.length === 4) break;
  }
  return excerpts.length >= 2 ? excerpts : [];
}

export function composeArticle({ headline, publisher, excerpts, language }) {
  const source = publisher.trim();
  const title = headline.trim();
  const dhivehi = language === 'dv';
  const lead = dhivehi
    ? `“${title}” މި ސުރުޚީގެ ދަށުން ${source} އިން ޚަބަރު އެރުވިއެވެ.`
    : `${source} reported: “${title}”`;
  const attribution = dhivehi ? 'ރިޕޯޓުގެ ބައެއް ބަސްތައް' : 'Excerpts from the original report';
  return [lead, attribution, ...excerpts.map(excerpt => `“${excerpt}”`)].join('\n\n');
}
