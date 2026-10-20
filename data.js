const LESSONS = [
  {
    "id": "unit1",
    "title": "Firefighter",
    "zh": "消防员",
    "icon": "🚒",
    "items": [
      {"id": "fire_station", "en": "fire station", "ipa": "ˈfaɪər ˌsteɪʃn", "zh": "消防站", "emoji": "🚒"},
      {"id": "alarm_bell", "en": "alarm bell", "ipa": "əˈlɑːrm bel", "zh": "警报铃", "emoji": "🚨"},
      {"id": "firefighter", "en": "firefighter", "ipa": "ˈfaɪərˌfaɪtər", "zh": "消防员", "emoji": "🧑‍🚒"},
      {"id": "hose", "en": "hose", "ipa": "hoʊz", "zh": "消防水管", "emoji": "🚿"},
      {"id": "save", "en": "save", "ipa": "seɪv", "zh": "救", "emoji": "🛟"},
      {"id": "cheer", "en": "cheer", "ipa": "tʃɪr", "zh": "欢呼", "emoji": "🙌"},
      {"id": "pole", "en": "pole", "ipa": "poʊl", "zh": "滑杆", "emoji": "<svg viewBox='0 0 64 64' width='52' height='52'><rect x='8' y='2' width='48' height='5' rx='2' fill='#8d6e63'/><rect x='29' y='6' width='6' height='50' rx='3' fill='#e53935'/><rect x='8' y='56' width='48' height='6' rx='3' fill='#8d6e63'/></svg>"},
      {"id": "s_alarm", "en": "Alarm bells ring!", "zh": "警报铃响啦！", "emoji": "🚨🔔", "sentence": true},
      {"id": "s_reach", "en": "We reach the building.", "zh": "我们到达大楼了。", "emoji": "🚒🏢", "sentence": true},
      {"id": "s_out", "en": "The fire is out!", "zh": "火被扑灭啦！", "emoji": "🔥💦", "sentence": true}
    ]
  },
  {
    "id": "unit2",
    "title": "I can be...",
    "zh": "我长大想当…",
    "icon": "🌟",
    "items": [
      {"id": "grow_up", "en": "grow up", "ipa": "ɡroʊ ʌp", "zh": "长大", "emoji": "🌱", "game": false},
      {"id": "job", "en": "job", "ipa": "dʒɑːb", "zh": "职业", "emoji": "💼", "game": false},
      {"id": "teacher", "en": "teacher", "ipa": "ˈtiːtʃər", "zh": "老师", "emoji": "🧑‍🏫", "sen": "I can be a teacher.", "senZh": "我可以当老师。"},
      {"id": "firefighter2", "en": "firefighter", "ipa": "ˈfaɪərˌfaɪtər", "zh": "消防员", "emoji": "🧑‍🚒", "sen": "I can be a firefighter.", "senZh": "我可以当消防员。"},
      {"id": "vet", "en": "vet", "ipa": "vet", "zh": "兽医", "emoji": "🐶🩺", "sen": "I can be a vet.", "senZh": "我可以当兽医。"},
      {"id": "mechanic", "en": "mechanic", "ipa": "məˈkænɪk", "zh": "修理工", "emoji": "🧑‍🔧", "sen": "I can be a mechanic.", "senZh": "我可以当修理工。"},
      {"id": "builder", "en": "builder", "ipa": "ˈbɪldər", "zh": "建筑工人", "emoji": "👷", "sen": "I can be a builder.", "senZh": "我可以当建筑工人。"},
      {"id": "footballer", "en": "footballer", "ipa": "ˈfʊtbɔːlər", "zh": "足球运动员", "emoji": "⚽", "sen": "I can be a footballer.", "senZh": "我可以当足球运动员。"},
      {"id": "musician", "en": "musician", "ipa": "mjuˈzɪʃn", "zh": "音乐家", "emoji": "🎻", "sen": "I can be a musician.", "senZh": "我可以当音乐家。"},
      {"id": "dancer", "en": "dancer", "ipa": "ˈdænsər", "zh": "舞蹈家", "emoji": "💃", "sen": "I can be a dancer.", "senZh": "我可以当舞蹈家。"},
      {"id": "hairdresser", "en": "hairdresser", "ipa": "ˈherˌdresər", "zh": "理发师", "emoji": "💇", "sen": "I can be a hairdresser.", "senZh": "我可以当理发师。"},
      {"id": "doctor", "en": "doctor", "ipa": "ˈdɑːktər", "zh": "医生", "emoji": "👨‍⚕️🩺", "sen": "I can be a doctor.", "senZh": "我可以当医生。"},
      {"id": "nurse", "en": "nurse", "ipa": "nɜːrs", "zh": "护士", "emoji": "👩‍⚕️💉", "sen": "I can be a nurse.", "senZh": "我可以当护士。"},
      {"id": "programmer", "en": "programmer", "ipa": "ˈproʊɡræmər", "zh": "程序员", "emoji": "🧑‍💻", "sen": "I can be a programmer.", "senZh": "我可以当程序员。"},
      {"id": "astronaut", "en": "astronaut", "ipa": "ˈæstrənɔːt", "zh": "宇航员", "emoji": "🧑‍🚀", "sen": "I can be an astronaut.", "senZh": "我可以当宇航员。"}
    ]
  }
];

// 通用提示语音（中文引导 + 英文鼓励）
const FX = [
  {"id": "fx_welcome_zh", "lang": "zh", "text": "点一点图片，听一听！"},
  {"id": "fx_find_zh", "lang": "zh", "text": "听一听，找一找！"},
  {"id": "fx_good_en", "lang": "en", "text": "Good job!"},
  {"id": "fx_good_zh", "lang": "zh", "text": "太棒了！"},
  {"id": "fx_try_en", "lang": "en", "text": "Try again!"},
  {"id": "fx_try_zh", "lang": "zh", "text": "再听一听，再试试哦！"},
  {"id": "fx_done_zh", "lang": "zh", "text": "你真棒！全部完成啦！"},
  {"id": "fx_quest_zh", "lang": "zh", "text": "今天的魔法任务开始啦！"},
  {"id": "fx_new_zh", "lang": "zh", "text": "认识一个新朋友！"},
  {"id": "fx_water_zh", "lang": "zh", "text": "给小树浇水啦！"},
  {"id": "fx_garden_zh", "lang": "zh", "text": "看，这是你的小花园！"},
  {"id": "fx_brave_zh", "lang": "zh", "text": "你真勇敢！"},
  {"id": "fx_mine_zh", "lang": "zh", "text": "听听你的声音！"},
  {"id": "fx_std_zh", "lang": "zh", "text": "再听听标准发音！"}
];
