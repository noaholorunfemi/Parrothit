(() => {
  'use strict';
  const rooms = {
    general:{name:'General',icon:'🌐',description:'Open discussion for every Wazobia member.'},
    dating:{name:'Dating',icon:'💞',description:'Meet people respectfully and make genuine connections.'},
    love:{name:'Love',icon:'❤️',description:'Talk about love, care and healthy relationships.'},
    romance:{name:'Romance',icon:'🌹',description:'Romantic stories, advice and thoughtful conversations.'},
    sports:{name:'Sports',icon:'⚽',description:'Sports talk, teams, training and active living.'},
    entertainment:{name:'Entertainment',icon:'🎬',description:'Movies, music, comedy and popular culture.'},
    education:{name:'Education',icon:'📚',description:'Learning, study tips, exams and opportunities.'},
    technology:{name:'Technology',icon:'💻',description:'Digital life, devices, science and innovation.'},
    politics:{name:'Politics',icon:'🗳️',description:'Discuss public affairs respectfully and thoughtfully.'},
    health:{name:'Health',icon:'🌿',description:'Wellbeing, healthy habits and fitness.'},
    business:{name:'Business',icon:'💼',description:'Entrepreneurship, jobs, skills and careers.'},
    culture:{name:'Culture',icon:'🎭',description:'Traditions, food, fashion and the arts.'},
    travel:{name:'Travel',icon:'🧭',description:'Places, travel stories and adventures.'},
    faith:{name:'Faith',icon:'🕊️',description:'Faith, values and respectful encouragement.'},
    gaming:{name:'Gaming',icon:'🎮',description:'Gaming, creativity and digital play.'}
  };
  const requested = (new URLSearchParams(location.search).get('room') || 'general').toLowerCase();
  const slug = Object.prototype.hasOwnProperty.call(rooms, requested) ? requested : 'general';
  const room = rooms[slug];
  window.PARROTHIT_ROOM = {slug, name:room.name, icon:room.icon, description:room.description};
  document.title = `${room.icon} ${room.name} | PARROTHIT Wazobia Trends`;
  const title = document.getElementById('roomTitle');
  const icon = document.getElementById('roomIcon');
  const description = document.getElementById('roomDescription');
  if (title) title.textContent = room.name;
  if (icon) icon.textContent = room.icon;
  if (description) description.textContent = room.description;
})();
