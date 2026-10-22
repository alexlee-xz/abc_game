/* ============ 字母 A–Z 的内容 ============
   id：小写字母（也是 audio/let|letw|letz/ 里的文件名）
   say：念字母名时给语音引擎的文字（大写单个字母，引擎会按字母名念）
   word / zh / emoji：这个字母的例词、中文、图片（先用 emoji，xylophone 是内联 SVG）
   这个文件必须是 JSON 兼容的写法：tools/gen_audio.py 会直接读它来生成语音。 */
const ALPHABET = [
  {"id": "a", "say": "A", "word": "apple", "zh": "苹果", "emoji": "🍎"},
  {"id": "b", "say": "B", "word": "ball", "zh": "球", "emoji": "⚽"},
  {"id": "c", "say": "C", "word": "cat", "zh": "猫", "emoji": "🐱"},
  {"id": "d", "say": "D", "word": "dog", "zh": "狗", "emoji": "🐶"},
  {"id": "e", "say": "E", "word": "egg", "zh": "鸡蛋", "emoji": "🥚"},
  {"id": "f", "say": "F", "word": "fish", "zh": "鱼", "emoji": "🐟"},
  {"id": "g", "say": "G", "word": "goat", "zh": "山羊", "emoji": "🐐"},
  {"id": "h", "say": "H", "word": "hat", "zh": "帽子", "emoji": "🎩"},
  {"id": "i", "say": "I", "word": "ice cream", "zh": "冰淇淋", "emoji": "🍦"},
  {"id": "j", "say": "J", "word": "jet", "zh": "喷气飞机", "emoji": "✈️"},
  {"id": "k", "say": "K", "word": "key", "zh": "钥匙", "emoji": "🔑"},
  {"id": "l", "say": "L", "word": "lion", "zh": "狮子", "emoji": "🦁"},
  {"id": "m", "say": "M", "word": "moon", "zh": "月亮", "emoji": "🌙"},
  {"id": "n", "say": "N", "word": "nose", "zh": "鼻子", "emoji": "👃"},
  {"id": "o", "say": "O", "word": "orange", "zh": "橙子", "emoji": "🍊"},
  {"id": "p", "say": "P", "word": "pig", "zh": "小猪", "emoji": "🐷"},
  {"id": "q", "say": "Q", "word": "queen", "zh": "女王", "emoji": "👑"},
  {"id": "r", "say": "R", "word": "rabbit", "zh": "兔子", "emoji": "🐰"},
  {"id": "s", "say": "S", "word": "sun", "zh": "太阳", "emoji": "☀️"},
  {"id": "t", "say": "T", "word": "tiger", "zh": "老虎", "emoji": "🐯"},
  {"id": "u", "say": "U", "word": "umbrella", "zh": "雨伞", "emoji": "☂️"},
  {"id": "v", "say": "V", "word": "van", "zh": "面包车", "emoji": "🚐"},
  {"id": "w", "say": "W", "word": "watch", "zh": "手表", "emoji": "⌚"},
  {"id": "x", "say": "X", "word": "xylophone", "zh": "木琴", "emoji": "<svg viewBox='0 0 64 64' width='52' height='52'><rect x='6' y='8' width='9' height='44' rx='3' fill='#e53935'/><rect x='18' y='14' width='9' height='38' rx='3' fill='#fb8c00'/><rect x='30' y='20' width='9' height='32' rx='3' fill='#fdd835'/><rect x='42' y='26' width='9' height='26' rx='3' fill='#43a047'/><rect x='54' y='32' width='6' height='20' rx='3' fill='#1e88e5'/><rect x='4' y='54' width='56' height='5' rx='2' fill='#8d6e63'/></svg>"},
  {"id": "y", "say": "Y", "word": "yarn", "zh": "毛线", "emoji": "🧶"},
  {"id": "z", "say": "Z", "word": "zebra", "zh": "斑马", "emoji": "🦓"}
];
