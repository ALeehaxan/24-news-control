const $ = id => document.getElementById(id);
let img = null;
let photoRequest = 0;

export function draw() {
  const context = $('poster').getContext('2d');
  context.fillStyle = '#101010';
  context.fillRect(0, 0, 1080, 1350);
  context.fillStyle = '#fff';
  context.font = '900 115px Arial';
  context.fillText('24', 65, 130);
  context.fillStyle = '#ef2929';
  context.fillRect(65, 155, 950, 12);
  context.fillStyle = '#292929';
  context.fillRect(65, 200, 950, 660);

  if (img) {
    const scale = Math.max(950 / img.width, 660 / img.height);
    context.save();
    context.beginPath();
    context.rect(65, 200, 950, 660);
    context.clip();
    context.drawImage(img, 65 + (950 - img.width * scale) / 2, 200 + (660 - img.height * scale) / 2,
      img.width * scale, img.height * scale);
    context.restore();
  } else {
    context.fillStyle = '#888';
    context.font = '32px Arial';
    context.fillText('PHOTO / NO IMAGE', 100, 540);
  }

  context.fillStyle = '#ef2929';
  context.font = 'bold 32px Arial';
  context.fillText($('category').value.toUpperCase(), 65, 920);

  const rtl = $('lang').value === 'dv';
  const headline = $(rtl ? 'dv' : 'en').value || 'News headline';
  context.fillStyle = '#fff';
  context.direction = rtl ? 'rtl' : 'ltr';
  context.textAlign = rtl ? 'right' : 'left';
  context.font = 'bold 58px Arial, sans-serif';
  const lines = [];
  let line = '';
  for (const word of headline.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (context.measureText(next).width > 950 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  lines.slice(0, 4).forEach((text, index) => {
    context.fillText(index === 3 && lines.length > 4 ? text + '…' : text, rtl ? 1015 : 65, 990 + index * 68, 950);
  });

  context.direction = 'ltr';
  context.textAlign = 'left';
  context.fillStyle = '#aaa';
  context.font = '26px Arial';
  context.fillText('24  /  NORTHERN MALDIVES', 65, 1300);
}

$('photo').onchange = () => {
  const request = ++photoRequest;
  const file = $('photo').files[0];
  img = null;
  draw();
  if (!file) return;

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    if (request === photoRequest) {
      img = image;
      draw();
    }
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    if (request === photoRequest) alert('Image could not be opened');
  };
  image.src = url;
};

for (const id of ['en', 'dv', 'category', 'lang']) $(id).addEventListener('input', draw);

export function resetPhoto() {
  img = null;
  photoRequest++;
  $('photo').value = '';
}

export function dl(url, name) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}

function downloadPoster() {
  draw();
  dl($('poster').toDataURL('image/png'), '24-news.png');
}

async function copyCaption() {
  const caption = ['en', 'bodyEn', 'dv', 'bodyDv', 'source'].map(id => $(id).value).filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(caption);
    alert('Caption copied');
  } catch {
    prompt('Copy caption:', caption);
  }
}

Object.assign(window, { draw, downloadPoster, copyCaption });
