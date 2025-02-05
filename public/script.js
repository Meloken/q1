/**************************************
 * script.js
 **************************************/
const socket = io();
let localStream;
let peers = {};
let audioPermissionGranted = false;
let remoteAudios = [];
let username = null;

// Mikrofon / Kulaklık
let micEnabled = true;
let selfDeafened = false;
let micWasEnabledBeforeDeaf = false;

let currentGroup = null;
let currentRoom = null;
let selectedGroup = null;

let pendingUsers = [];
let pendingNewUsers = [];
let pendingCandidates = {};  // ICE candidate'leri bekletmek için
let sessionUfrag = {};       // session ufrag takibi

let audioAnalyzers = {};
const SPEAKING_THRESHOLD = 0.0;
const VOLUME_CHECK_INTERVAL = 100;
let pingInterval = null;

/* 
  Odada kimler var => son kayıtlardan izlemek için
*/
let lastUserIdsInRoom = new Set();

/* Kanal listesinde (roomsList) "volume_up" ikonu göstermek istediğimizde
   createWaveIcon() çağrılır. */
function createWaveIcon() {
  const icon = document.createElement('span');
  icon.classList.add('material-icons');
  icon.classList.add('channel-icon');
  icon.textContent = 'volume_up';
  return icon;
}

// DOM Referansları
const loginScreen = document.getElementById('loginScreen');
const registerScreen = document.getElementById('registerScreen');
const callScreen = document.getElementById('callScreen');

// Login
const loginUsernameInput = document.getElementById('loginUsernameInput');
const loginPasswordInput = document.getElementById('loginPasswordInput');
const loginButton = document.getElementById('loginButton');
const loginErrorMessage = document.getElementById('loginErrorMessage');

// Register
const regUsernameInput = document.getElementById('regUsernameInput');
const regNameInput = document.getElementById('regNameInput');
const regSurnameInput = document.getElementById('regSurnameInput');
const regBirthdateInput = document.getElementById('regBirthdateInput');
const regEmailInput = document.getElementById('regEmailInput');
const regPhoneInput = document.getElementById('regPhoneInput');
const regPasswordInput = document.getElementById('regPasswordInput');
const regPasswordConfirmInput = document.getElementById('regPasswordConfirmInput');
const registerButton = document.getElementById('registerButton');
const backToLoginButton = document.getElementById('backToLoginButton');
const registerErrorMessage = document.getElementById('registerErrorMessage');

// Ekran geçiş linkleri
const showRegisterScreen = document.getElementById('showRegisterScreen');
const showLoginScreen = document.getElementById('showLoginScreen');

// Gruplar
const groupListDiv = document.getElementById('groupList');
const createGroupButton = document.getElementById('createGroupButton');

// Odalar
const roomListDiv = document.getElementById('roomList');
const groupTitle = document.getElementById('groupTitle');
const groupDropdownIcon = document.getElementById('groupDropdownIcon');
const groupDropdownMenu = document.getElementById('groupDropdownMenu');
const copyGroupIdBtn = document.getElementById('copyGroupIdBtn');
const renameGroupBtn = document.getElementById('renameGroupBtn');
const createChannelBtn = document.getElementById('createChannelBtn');
const deleteGroupBtn = document.getElementById('deleteGroupBtn');

// DM panel
const toggleDMButton = document.getElementById('toggleDMButton');
const closeDMButton = document.getElementById('closeDMButton');
let isDMMode = false;

// Sağ panel (userList)
const userListDiv = document.getElementById('userList');

// Kanal Durum Paneli
const channelStatusPanel = document.getElementById('channelStatusPanel');
const pingValueSpan = document.getElementById('pingValue');
const cellBar1 = document.getElementById('cellBar1');
const cellBar2 = document.getElementById('cellBar2');
const cellBar3 = document.getElementById('cellBar3');
const cellBar4 = document.getElementById('cellBar4');

// Ayrıl Butonu
const leaveButton = document.getElementById('leaveButton');

// Mikrofon / Kulaklık butonları
const micToggleButton = document.getElementById('micToggleButton');
const deafenToggleButton = document.getElementById('deafenToggleButton');
const settingsButton = document.getElementById('settingsButton');

/* YENİ: Sohbet paneli elemanları */
const textChatArea = document.getElementById('textChatArea');
const chatMessagesDiv = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

/*
  =======================================
  closeAllPeers()
  =======================================
*/
function closeAllPeers() {
  // Tüm peer bağlantılarını kapatıp temizliyoruz
  for (const userId in peers) {
    if (peers[userId]) {
      peers[userId].close();
      delete peers[userId];
    }
    stopVolumeAnalysis(userId);
  }
  remoteAudios = [];
  pendingCandidates = {};
  sessionUfrag = {};
}

/* ====== LOGIN / REGISTER Geçişleri ====== */
showRegisterScreen.addEventListener('click', () => {
  loginScreen.style.display = 'none';
  registerScreen.style.display = 'block';
});
showLoginScreen.addEventListener('click', () => {
  registerScreen.style.display = 'none';
  loginScreen.style.display = 'block';
});
backToLoginButton.addEventListener('click', () => {
  registerScreen.style.display = 'none';
  loginScreen.style.display = 'block';
});

/* ====== LOGIN ====== */
function attemptLogin() {
  const usernameVal = loginUsernameInput.value.trim();
  const passwordVal = loginPasswordInput.value.trim();

  loginErrorMessage.style.display = 'none';
  loginUsernameInput.classList.remove('shake');
  loginPasswordInput.classList.remove('shake');

  if (!usernameVal || !passwordVal) {
    loginErrorMessage.textContent = "Lütfen gerekli alanları doldurunuz";
    loginErrorMessage.style.display = 'block';
    loginUsernameInput.classList.add('shake');
    loginPasswordInput.classList.add('shake');
    return;
  }
  socket.emit('login', { username: usernameVal, password: passwordVal });
}
loginButton.addEventListener('click', attemptLogin);
loginUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});
loginPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});

socket.on('loginResult', (data) => {
  if (data.success) {
    username = data.username;
    loginScreen.style.display = 'none';
    callScreen.style.display = 'flex';
    socket.emit('set-username', username);
    document.getElementById('leftUserName').textContent = username;
    applyAudioStates();
  } else {
    loginErrorMessage.textContent = "Lütfen girdiğiniz bilgileri kontrol edip tekrar deneyin";
    loginErrorMessage.style.display = 'block';
    loginUsernameInput.classList.add('shake');
    loginPasswordInput.classList.add('shake');
  }
});

/* ====== REGISTER ====== */
registerButton.addEventListener('click', () => {
  const userData = {
    username: regUsernameInput.value.trim(),
    name: regNameInput.value.trim(),
    surname: regSurnameInput.value.trim(),
    birthdate: regBirthdateInput.value.trim(),
    email: regEmailInput.value.trim(),
    phone: regPhoneInput.value.trim(),
    password: regPasswordInput.value.trim(),
    passwordConfirm: regPasswordConfirmInput.value.trim()
  };

  registerErrorMessage.style.display = 'none';
  regUsernameInput.classList.remove('shake');
  regPasswordInput.classList.remove('shake');
  regPasswordConfirmInput.classList.remove('shake');

  let isError = false;
  if (!userData.username || !userData.name || !userData.surname ||
      !userData.birthdate || !userData.email || !userData.phone ||
      !userData.password || !userData.passwordConfirm) {
    regUsernameInput.classList.add('shake');
    regPasswordInput.classList.add('shake');
    regPasswordConfirmInput.classList.add('shake');
    registerErrorMessage.style.display = 'block';
    registerErrorMessage.textContent = "Lütfen girdiğiniz bilgileri kontrol edip tekrar deneyin";
    isError = true;
  } else if (userData.username !== userData.username.toLowerCase()) {
    regUsernameInput.classList.add('shake');
    registerErrorMessage.style.display = 'block';
    registerErrorMessage.textContent = "Kullanıcı adı sadece küçük harf olmalı!";
    isError = true;
  } else if (userData.password !== userData.passwordConfirm) {
    regPasswordInput.classList.add('shake');
    regPasswordConfirmInput.classList.add('shake');
    registerErrorMessage.style.display = 'block';
    registerErrorMessage.textContent = "Parolalar eşleşmiyor!";
    isError = true;
  }

  if (!isError) {
    socket.emit('register', userData);
  }
});
socket.on('registerResult', (data) => {
  if (data.success) {
    registerScreen.style.display = 'none';
    loginScreen.style.display = 'block';
  } else {
    registerErrorMessage.style.display = 'block';
    registerErrorMessage.textContent = data.message || "Lütfen girdiğiniz bilgileri kontrol edip tekrar deneyin";
    regUsernameInput.classList.add('shake');
    regPasswordInput.classList.add('shake');
    regPasswordConfirmInput.classList.add('shake');
  }
});

/* Grup/Oda oluşturma, DM vb. */
createGroupButton.addEventListener('click', () => {
  document.getElementById('groupModal').style.display = 'flex';
});
document.getElementById('modalGroupCreateBtn').addEventListener('click', () => {
  document.getElementById('groupModal').style.display = 'none';
  document.getElementById('actualGroupCreateModal').style.display = 'flex';
});
document.getElementById('modalGroupJoinBtn').addEventListener('click', () => {
  document.getElementById('groupModal').style.display = 'none';
  document.getElementById('joinGroupModal').style.display = 'flex';
});
document.getElementById('actualGroupNameBtn').addEventListener('click', () => {
  const grpName = document.getElementById('actualGroupName').value.trim();
  if (!grpName) {
    alert("Grup adı boş olamaz!");
    return;
  }
  socket.emit('createGroup', grpName);
  document.getElementById('actualGroupCreateModal').style.display = 'none';
});
document.getElementById('closeCreateGroupModal').addEventListener('click', () => {
  document.getElementById('actualGroupCreateModal').style.display = 'none';
});
document.getElementById('joinGroupIdBtn').addEventListener('click', () => {
  const grpIdVal = document.getElementById('joinGroupIdInput').value.trim();
  if (!grpIdVal) {
    alert("Grup ID boş olamaz!");
    return;
  }
  socket.emit('joinGroupByID', grpIdVal);
  document.getElementById('joinGroupModal').style.display = 'none';
});
document.getElementById('closeJoinGroupModal').addEventListener('click', () => {
  document.getElementById('joinGroupModal').style.display = 'none';
});
document.getElementById('modalCreateRoomBtn').addEventListener('click', () => {
  const rName = document.getElementById('modalRoomName').value.trim();
  const channelType = document.getElementById('modalRoomTypeSelect').value;  // 'text','voice','both'
  if (!rName) {
    alert("Oda adı girin!");
    return;
  }
  const grp = currentGroup || selectedGroup;
  if (!grp) {
    alert("Önce bir gruba katılın!");
    return;
  }
  socket.emit('createRoom', { groupId: grp, roomName: rName, channelType });
  document.getElementById('roomModal').style.display = 'none';
});
document.getElementById('modalCloseRoomBtn').addEventListener('click', () => {
  document.getElementById('roomModal').style.display = 'none';
});

/* groupsList => sol sidebar */
socket.on('groupsList', (groupArray) => {
  groupListDiv.innerHTML = '';
  groupArray.forEach(groupObj => {
    const grpItem = document.createElement('div');
    grpItem.className = 'grp-item';
    grpItem.innerText = groupObj.name[0].toUpperCase();
    grpItem.title = groupObj.name + " (" + groupObj.id + ")";

    grpItem.addEventListener('click', () => {
      document.querySelectorAll('.grp-item').forEach(el => el.classList.remove('selected'));
      grpItem.classList.add('selected');

      selectedGroup = groupObj.id;

      // === DÜZELTME: Yalnızca farklı gruba tıklanırsa currentGroup'ı sıfırla
      if (currentGroup !== groupObj.id) {
        currentGroup = null;
      }

      groupTitle.textContent = groupObj.name;
      socket.emit('browseGroup', groupObj.id);

      if (groupObj.owner === username) {
        deleteGroupBtn.style.display = 'block';
        renameGroupBtn.style.display = 'block';
      } else {
        deleteGroupBtn.style.display = 'none';
        renameGroupBtn.style.display = 'none';
      }
    });

    groupListDiv.appendChild(grpItem);
  });
});

/* groupDropdownIcon => menüyü aç/kapat */
groupDropdownIcon.addEventListener('click', () => {
  if (groupDropdownMenu.style.display === 'none' || groupDropdownMenu.style.display === '') {
    groupDropdownMenu.style.display = 'block';
  } else {
    groupDropdownMenu.style.display = 'none';
  }
});
copyGroupIdBtn.addEventListener('click', () => {
  groupDropdownMenu.style.display = 'none';
  const grp = currentGroup || selectedGroup;
  if (!grp) {
    alert("Şu an bir grup seçili değil!");
    return;
  }
  navigator.clipboard.writeText(grp)
    .then(() => alert("Grup ID kopyalandı: " + grp))
    .catch(err => {
      console.error("Kopyalama hatası:", err);
      alert("Kopyalama başarısız!");
    });
});
renameGroupBtn.addEventListener('click', () => {
  groupDropdownMenu.style.display = 'none';
  const grp = currentGroup || selectedGroup;
  if (!grp) {
    alert("Şu an bir grup seçili değil!");
    return;
  }
  const newName = prompt("Yeni grup ismini girin:");
  if (!newName || !newName.trim()) {
    alert("Grup ismi boş olamaz!");
    return;
  }
  socket.emit('renameGroup', { groupId: grp, newName: newName.trim() });
});
createChannelBtn.addEventListener('click', () => {
  groupDropdownMenu.style.display = 'none';
  const grp = currentGroup || selectedGroup;
  if (!grp) {
    alert("Önce bir gruba katılın!");
    return;
  }
  document.getElementById('roomModal').style.display = 'flex';
  document.getElementById('modalRoomName').value = '';
  document.getElementById('modalRoomName').focus();
});
deleteGroupBtn.addEventListener('click', () => {
  groupDropdownMenu.style.display = 'none';
  const grp = currentGroup || selectedGroup;
  if (!grp) {
    alert("Şu an bir grup seçili değil!");
    return;
  }
  const confirmDel = confirm("Bu grubu silmek istediğinize emin misiniz?");
  if (!confirmDel) return;
  socket.emit('deleteGroup', grp);
});

/* DM paneli */
toggleDMButton.addEventListener('click', () => {
  const dmPanel = document.getElementById('dmPanel');
  if (dmPanel.style.display === 'none' || dmPanel.style.display === '') {
    dmPanel.style.display = 'block';
    isDMMode = true;
  } else {
    dmPanel.style.display = 'none';
    isDMMode = false;
  }
});
closeDMButton.addEventListener('click', () => {
  document.getElementById('dmPanel').style.display = 'none';
  isDMMode = false;
});

/* Kanal context menu */
const channelContextMenu = document.createElement('div');
channelContextMenu.classList.add('context-menu');
channelContextMenu.style.display = 'none';
channelContextMenu.innerHTML = `
  <div class="context-menu-item" id="renameChannelOption">Kanalın adını değiştir</div>
  <div class="context-menu-item" id="deleteChannelOption">Kanalı sil</div>
`;
document.body.appendChild(channelContextMenu);

let rightClickedChannelId = null;
document.getElementById('renameChannelOption').addEventListener('click', () => {
  if (!rightClickedChannelId) return;
  const newName = prompt("Kanal için yeni isim girin:");
  if (!newName || !newName.trim()) {
    channelContextMenu.style.display = 'none';
    return;
  }
  socket.emit('renameChannel', { channelId: rightClickedChannelId, newName: newName.trim() });
  channelContextMenu.style.display = 'none';
  rightClickedChannelId = null;
});
document.getElementById('deleteChannelOption').addEventListener('click', () => {
  if (!rightClickedChannelId) return;
  const confirmDel = confirm("Kanalı silmek istediğinizden emin misiniz?");
  if (!confirmDel) {
    channelContextMenu.style.display = 'none';
    return;
  }
  socket.emit('deleteChannel', rightClickedChannelId);
  channelContextMenu.style.display = 'none';
  rightClickedChannelId = null;
});
document.addEventListener('click', () => {
  if (channelContextMenu.style.display === 'block') {
    channelContextMenu.style.display = 'none';
  }
});

/* 
  ==================================
  ROOMS LIST => KANALLARI AYIRIYORUZ
  ==================================
*/
socket.on('roomsList', (roomsArray) => {
  // 1) Kanalları tiplerine göre ayır (text / voice / both)
  const textChannels = [];
  const voiceChannels = [];
  const bothChannels = [];

  roomsArray.forEach(room => {
    if (room.type === 'text') textChannels.push(room);
    else if (room.type === 'voice') voiceChannels.push(room);
    else bothChannels.push(room); // type = 'both'
  });

  // 2) Paneli temizle
  roomListDiv.innerHTML = '';

  // 3) Metin Kanalları (text)
  if (textChannels.length > 0) {
    const textHeader = document.createElement('div');
    textHeader.style.margin = '0.5rem 0 0.3rem 0';
    textHeader.style.fontSize = '0.85rem';
    textHeader.style.fontWeight = 'bold';
    textHeader.textContent = 'METİN KANALLARI';
    roomListDiv.appendChild(textHeader);

    textChannels.forEach(roomObj => {
      createChannelItem(roomObj);
    });
  }

  // 4) Ses Kanalları (voice)
  if (voiceChannels.length > 0) {
    const voiceHeader = document.createElement('div');
    voiceHeader.style.margin = '0.5rem 0 0.3rem 0';
    voiceHeader.style.fontSize = '0.85rem';
    voiceHeader.style.fontWeight = 'bold';
    voiceHeader.textContent = 'SES KANALLARI';
    roomListDiv.appendChild(voiceHeader);

    voiceChannels.forEach(roomObj => {
      createChannelItem(roomObj);
    });
  }

  // 5) Hem Ses Hem Metin (both)
  if (bothChannels.length > 0) {
    const bothHeader = document.createElement('div');
    bothHeader.style.margin = '0.5rem 0 0.3rem 0';
    bothHeader.style.fontSize = '0.85rem';
    bothHeader.style.fontWeight = 'bold';
    bothHeader.textContent = 'KARMA KANALLAR';
    roomListDiv.appendChild(bothHeader);

    bothChannels.forEach(roomObj => {
      createChannelItem(roomObj);
    });
  }
});

/* 
  Yardımcı fonksiyon: Kanal Item oluşturup ekrana basar
  (roomsList eventinde kullanıyoruz)
*/
function createChannelItem(roomObj) {
  const roomItem = document.createElement('div');
  roomItem.className = 'channel-item';

  // Kanal Başlığı
  const channelHeader = document.createElement('div');
  channelHeader.className = 'channel-header';
  const icon = createWaveIcon(); 
  const textSpan = document.createElement('span');
  textSpan.textContent = roomObj.name;
  channelHeader.appendChild(icon);
  channelHeader.appendChild(textSpan);

  // Kullanıcı listesi
  const channelUsers = document.createElement('div');
  channelUsers.className = 'channel-users';
  channelUsers.id = `channel-users-${roomObj.id}`;

  roomItem.appendChild(channelHeader);
  roomItem.appendChild(channelUsers);

  // Tıklayınca => Kanala gir
  roomItem.addEventListener('click', () => {
    document.querySelectorAll('.channel-item').forEach(ci => ci.classList.remove('connected'));

    if (currentRoom === roomObj.id && currentGroup === selectedGroup) {
      roomItem.classList.add('connected');
      return;
    }
    if (currentRoom && (currentRoom !== roomObj.id || currentGroup !== selectedGroup)) {
      socket.emit('leaveRoom', { groupId: currentGroup, roomId: currentRoom });
      closeAllPeers();
      hideChannelStatusPanel();
      currentRoom = null;
    }
    currentGroup = selectedGroup;

    joinRoom(currentGroup, roomObj.id, roomObj.name);

    roomItem.classList.add('connected');

    // Kanal 'voice' ise metin sohbeti kapat, 'text' veya 'both' ise aç
    if (roomObj.type === 'voice') {
      disableChatUI();
    } else {
      enableChatUI();
    }
  });

  // Sağ tık => context menu
  roomItem.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    rightClickedChannelId = roomObj.id;
    channelContextMenu.style.left = e.pageX + 'px';
    channelContextMenu.style.top = e.pageY + 'px';
    channelContextMenu.style.display = 'block';
  });

  roomListDiv.appendChild(roomItem);
}

/* allChannelsData => soldaki kanal listesi (kim var) */
socket.on('allChannelsData', (channelsObj) => {
  Object.keys(channelsObj).forEach(roomId => {
    const cData = channelsObj[roomId];
    const channelDiv = document.getElementById(`channel-users-${roomId}`);
    if (!channelDiv) return;
    channelDiv.innerHTML = '';

    cData.users.forEach(u => {
      // user row
      const userRow = document.createElement('div');
      userRow.classList.add('channel-user');

      const leftDiv = document.createElement('div');
      leftDiv.classList.add('channel-user-left');

      const avatarDiv = document.createElement('div');
      avatarDiv.classList.add('channel-user-avatar');
      avatarDiv.id = `avatar-${u.id}`;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = u.username || '(İsimsiz)';

      leftDiv.appendChild(avatarDiv);
      leftDiv.appendChild(nameSpan);

      const buttonsDiv = document.createElement('div');
      buttonsDiv.classList.add('channel-user-buttons');

      if (u.id === socket.id) {
        // Mic kapalıysa icon
        if (!u.micEnabled) {
          const micIcon = document.createElement('span');
          micIcon.classList.add('material-icons');
          micIcon.style.color = '#c61884';
          micIcon.style.fontSize = '18px';
          micIcon.textContent = 'mic_off';
          buttonsDiv.appendChild(micIcon);
        }
        // Deaf
        if (u.selfDeafened) {
          const deafIcon = document.createElement('span');
          deafIcon.classList.add('material-icons');
          deafIcon.style.color = '#c61884';
          deafIcon.style.fontSize = '18px';
          deafIcon.textContent = 'headset_off';
          buttonsDiv.appendChild(deafIcon);
        }
      }

      userRow.appendChild(leftDiv);
      userRow.appendChild(buttonsDiv);

      channelDiv.appendChild(userRow);
    });
  });
});

/* groupUsers => sağ panel */
socket.on('groupUsers', (dbUsersArray) => {
  updateUserList(dbUsersArray);
});
function updateUserList(data) {
  userListDiv.innerHTML = '';

  const onlineTitle = document.createElement('div');
  onlineTitle.textContent = 'Çevrimiçi';
  onlineTitle.style.fontWeight = 'normal';
  onlineTitle.style.fontSize = '0.85rem';
  userListDiv.appendChild(onlineTitle);

  if (data.online && data.online.length > 0) {
    data.online.forEach(u => {
      userListDiv.appendChild(createUserItem(u.username, true));
    });
  } else {
    const noneP = document.createElement('p');
    noneP.textContent = '(Kimse yok)';
    noneP.style.fontSize = '0.75rem';
    userListDiv.appendChild(noneP);
  }

  const offlineTitle = document.createElement('div');
  offlineTitle.textContent = 'Çevrimdışı';
  offlineTitle.style.fontWeight = 'normal';
  offlineTitle.style.fontSize = '0.85rem';
  offlineTitle.style.marginTop = '1rem';
  userListDiv.appendChild(offlineTitle);

  if (data.offline && data.offline.length > 0) {
    data.offline.forEach(u => {
      userListDiv.appendChild(createUserItem(u.username, false));
    });
  } else {
    const noneP2 = document.createElement('p');
    noneP2.textContent = '(Kimse yok)';
    noneP2.style.fontSize = '0.75rem';
    userListDiv.appendChild(noneP2);
  }
}

function createUserItem(username, isOnline) {
  const userItem = document.createElement('div');
  userItem.classList.add('user-item');

  const profileThumb = document.createElement('div');
  profileThumb.classList.add('profile-thumb');
  profileThumb.style.backgroundColor = isOnline ? '#2dbf2d' : '#777';

  const userNameSpan = document.createElement('span');
  userNameSpan.classList.add('user-name');
  userNameSpan.textContent = username;

  const copyIdBtn = document.createElement('button');
  copyIdBtn.classList.add('copy-id-btn');
  copyIdBtn.textContent = "ID Kopyala";
  copyIdBtn.dataset.userid = username;
  copyIdBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(username)
      .then(() => alert("Kullanıcı kopyalandı: " + username))
      .catch(err => {
        console.error("Kopyalama hatası:", err);
        alert("Kopyalama başarısız!");
      });
  });

  userItem.appendChild(profileThumb);
  userItem.appendChild(userNameSpan);
  userItem.appendChild(copyIdBtn);

  return userItem;
}

/* Mikrofon Erişimi */
async function requestMicrophoneAccess() {
  try {
    console.log("Mikrofon izni isteniyor...");
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log("Mikrofon erişimi verildi:", stream);
    localStream = stream;
    audioPermissionGranted = true;
    applyAudioStates();
    startVolumeAnalysis(stream, socket.id);

    remoteAudios.forEach(audioEl => {
      audioEl.play().catch(err => console.error("Ses oynatılamadı:", err));
    });
  } catch(err) {
    console.error("Mikrofon izni alınamadı:", err);
  }
}

function initPeer(userId, isInitiator) {
  if (!localStream || !audioPermissionGranted) {
    if (isInitiator) {
      pendingUsers.push(userId);
    } else {
      pendingNewUsers.push(userId);
    }
    return;
  }
  if (peers[userId] && peers[userId].connectionState !== 'closed') {
    return peers[userId];
  }

  console.log("initPeer =>", userId, "isInitiator?", isInitiator);

  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "6975c20c80cb0d79f1e4a4b6",
        credential: "BCHrcOSfdcmZ/Dda",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "6975c20c80cb0d79f1e4a4b6",
        credential: "BCHrcOSfdcmZ/Dda",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "6975c20c80cb0d79f1e4a4b6",
        credential: "BCHrcOSfdcmZ/Dda",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "6975c20c80cb0d79f1e4a4b6",
        credential: "BCHrcOSfdcmZ/Dda",
      },
    ],
  });
  peers[userId] = peer;

  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("signal", { to: userId, signal: ev.candidate });
    }
  };
  peer.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = false;
    audio.muted = false;
    audio.dataset.peerId = userId;
    remoteAudios.push(audio);

    startVolumeAnalysis(event.streams[0], userId);

    if (audioPermissionGranted) {
      audio.play().catch(err => console.error("Ses oynatılamadı:", err));
    }
  };
  peer.onconnectionstatechange = () => {
    console.log("Peer", userId, "state:", peer.connectionState);
  };

  if (isInitiator) createOffer(peer, userId);

  return peer;
}

async function createOffer(peer, userId) {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit("signal", { to: userId, signal: peer.localDescription });
}

function initPeerWithCheck(targetId) {
  if (!peers[targetId] || peers[targetId].connectionState === 'closed') {
    const isInit = (socket.id < targetId);
    initPeer(targetId, isInit);
  }
}

function initPeersForAllUsersInRoom() {
  if (!currentRoom || !audioPermissionGranted || !localStream) return;
  lastUserIdsInRoom.forEach(uid => {
    if (uid !== socket.id) {
      if (!peers[uid] || peers[uid].connectionState === 'closed') {
        const isInit = (socket.id < uid);
        initPeer(uid, isInit);
      }
    }
  });
}

socket.on("signal", async (data) => {
  if (data.from === socket.id) return;

  const { from, signal } = data;
  let peer = peers[from];

  if (!peer || peer.connectionState === 'closed') {
    if (!localStream) {
      console.warn("localStream yok => pending user:", from);
      pendingNewUsers.push(from);
      return;
    }
    const isInit = (socket.id < from);
    peer = initPeer(from, isInit);
  }

  if (signal.type === "offer") {
    await peer.setRemoteDescription(new RTCSessionDescription(signal));
    sessionUfrag[from] = parseIceUfrag(signal.sdp);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("signal", { to: from, signal: peer.localDescription });
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription(new RTCSessionDescription(signal));
    sessionUfrag[from] = parseIceUfrag(signal.sdp);

    if (pendingCandidates[from]) {
      for (const candidateObj of pendingCandidates[from]) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidateObj));
        } catch (err) {
          console.warn("ICE Candidate hata (pending):", err);
        }
      }
      delete pendingCandidates[from];
    }
  } else if (signal.candidate) {
    if (!peer.remoteDescription || peer.remoteDescription.type === "") {
      if (!pendingCandidates[from]) {
        pendingCandidates[from] = [];
      }
      pendingCandidates[from].push(signal);
    } else {
      if (sessionUfrag[from] 
          && sessionUfrag[from] !== signal.usernameFragment 
          && signal.usernameFragment !== null) {
        return;
      }
      try {
        await peer.addIceCandidate(new RTCIceCandidate(signal));
      } catch (err) {
        console.warn("ICE Candidate hata:", err);
      }
    }
  }
});

socket.on('joinRoomAck', ({ groupId, roomId }) => {
  console.log("joinRoomAck =>", groupId, roomId);
  if (!audioPermissionGranted || !localStream) {
    requestMicrophoneAccess().then(() => {
      initPeersForAllUsersInRoom();
    });
  } else {
    initPeersForAllUsersInRoom();
  }
});

socket.on('roomUsers', (usersInRoom) => {
  console.log("roomUsers => odadaki kisiler:", usersInRoom);

  const newSet = new Set(usersInRoom.map(u => u.id));

  // Kapatılması gereken peers
  for (const pid of Object.keys(peers)) {
    if (!newSet.has(pid)) {
      if (peers[pid]) {
        peers[pid].close();
      }
      delete peers[pid];
      stopVolumeAnalysis(pid);

      remoteAudios = remoteAudios.filter(audioEl => {
        if (audioEl.dataset && audioEl.dataset.peerId === pid) {
          try { audioEl.pause(); } catch (e) {}
          audioEl.srcObject = null;
          return false;
        }
        return true;
      });
    }
  }

  // Yeni user geldiyse => initPeerWithCheck
  if (currentRoom) {
    usersInRoom.forEach(u => {
      if (u.id !== socket.id) {
        if (!peers[u.id] || peers[u.id].connectionState === 'closed') {
          if (!audioPermissionGranted || !localStream) {
            requestMicrophoneAccess().then(() => {
              initPeerWithCheck(u.id);
            });
          } else {
            initPeerWithCheck(u.id);
          }
        }
      }
    });
  }

  lastUserIdsInRoom = newSet;

  // Kartları göster
  renderUsersInMainContent(usersInRoom);
});

/* Kanaldan Ayrıl */
leaveButton.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('leaveRoom', { groupId: currentGroup, roomId: currentRoom });
  closeAllPeers();
  hideChannelStatusPanel();
  currentRoom = null;

  document.getElementById('selectedChannelTitle').textContent = 'Kanal Seçilmedi';

  const container = document.getElementById('channelUsersContainer');
  if (container) {
    container.innerHTML = '';
    container.classList.remove('layout-1-user','layout-2-users','layout-3-users','layout-4-users','layout-n-users');
  }

  if (currentGroup) {
    socket.emit('browseGroup', currentGroup);
  }
});

/* Mikrofon & Kulaklık => sunucuya audioStateChanged */
micToggleButton.addEventListener('click', () => {
  micEnabled = !micEnabled;
  applyAudioStates();
});
deafenToggleButton.addEventListener('click', () => {
  if (!selfDeafened) {
    micWasEnabledBeforeDeaf = micEnabled;
    selfDeafened = true;
    micEnabled = false;
  } else {
    selfDeafened = false;
    if (micWasEnabledBeforeDeaf) micEnabled = true;
  }
  applyAudioStates();
});

function applyAudioStates() {
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      track.enabled = micEnabled && !selfDeafened;
    });
  }
  if (!micEnabled || selfDeafened) {
    micToggleButton.innerHTML = '<span class="material-icons">mic_off</span>';
    micToggleButton.classList.add('btn-muted');
  } else {
    micToggleButton.innerHTML = '<span class="material-icons">mic</span>';
    micToggleButton.classList.remove('btn-muted');
  }
  if (selfDeafened) {
    deafenToggleButton.innerHTML = '<span class="material-icons">headset_off</span>';
    deafenToggleButton.classList.add('btn-muted');
  } else {
    deafenToggleButton.innerHTML = '<span class="material-icons">headset</span>';
    deafenToggleButton.classList.remove('btn-muted');
  }
  remoteAudios.forEach(audio => {
    audio.muted = selfDeafened;
  });
  socket.emit('audioStateChanged', { micEnabled, selfDeafened });
}

function parseIceUfrag(sdp) {
  const lines = sdp.split('\n');
  for (const line of lines) {
    if (line.startsWith('a=ice-ufrag:')) {
      return line.split(':')[1].trim();
    }
  }
  return null;
}

/* groupRenamed => UI update => */
socket.on('groupRenamed', (data) => {
  const { groupId, newName } = data;
  if (currentGroup === groupId || selectedGroup === groupId) {
    groupTitle.textContent = newName;
  }
  socket.emit('set-username', username);
});

/* groupDeleted => UI reset => */
socket.on('groupDeleted', (data) => {
  const { groupId } = data;
  if (currentGroup === groupId) {
    currentGroup = null;
    currentRoom = null;
    groupTitle.textContent = "Seçili Grup";
    userListDiv.innerHTML = '';
    roomListDiv.innerHTML = '';
    hideChannelStatusPanel();
  }
  if (selectedGroup === groupId) {
    selectedGroup = null;
    groupTitle.textContent = "Seçili Grup";
    userListDiv.innerHTML = '';
    roomListDiv.innerHTML = '';
    hideChannelStatusPanel();
  }
  socket.emit('set-username', username);
});

/* Socket Durum */
socket.on("connect", () => {
  console.log("WebSocket bağlandı:", socket.id);
});
socket.on("disconnect", () => {
  console.log("WebSocket bağlantısı koptu.");
  hideChannelStatusPanel();
});

/* Konuşma Algılama => startVolumeAnalysis, stopVolumeAnalysis */
function startVolumeAnalysis(stream, userId) {
  stopVolumeAnalysis(userId);

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.fftSize);
  const interval = setInterval(() => {
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128.0;
      sum += Math.abs(val);
    }
    const average = sum / dataArray.length;
    const avatarElem = document.getElementById(`avatar-${userId}`);
    if (avatarElem) {
      if (average > SPEAKING_THRESHOLD) {
        avatarElem.classList.add('speaking');
      } else {
        avatarElem.classList.remove('speaking');
      }
    }
  }, VOLUME_CHECK_INTERVAL);

  audioAnalyzers[userId] = {
    audioContext,
    analyser,
    dataArray,
    interval
  };
}
function stopVolumeAnalysis(userId) {
  if (audioAnalyzers[userId]) {
    clearInterval(audioAnalyzers[userId].interval);
    audioAnalyzers[userId].audioContext.close().catch(() => {});
    delete audioAnalyzers[userId];
  }
}

/* joinRoom => Kanala giriş */
function joinRoom(groupId, roomId, roomName) {
  socket.emit('joinRoom', { groupId, roomId });
  document.getElementById('selectedChannelTitle').textContent = roomName;
  showChannelStatusPanel();
  currentGroup = groupId;
  currentRoom = roomId;
}

/* Kanal Durum Paneli => ping + bars */
function showChannelStatusPanel() {
  channelStatusPanel.style.display = 'block';
  startPingInterval();
}
function hideChannelStatusPanel() {
  channelStatusPanel.style.display = 'none';
  stopPingInterval();
}
function startPingInterval() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    let pingMs = 0;
    if (socket && socket.io && socket.io.engine && socket.io.engine.lastPingTimestamp) {
      const now = Date.now();
      pingMs = now - socket.io.engine.lastPingTimestamp;
      pingValueSpan.textContent = pingMs + ' ms';
    } else {
      pingValueSpan.textContent = '-- ms';
    }
    updateCellBars(pingMs);
  }, 1000);
}
function stopPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  pingValueSpan.textContent = '-- ms';
  updateCellBars(0);
}
function updateCellBars(ping) {
  let barsActive = 0;
  if (ping >= 1) {
    if (ping < 80) barsActive = 4;
    else if (ping < 150) barsActive = 3;
    else if (ping < 300) barsActive = 2;
    else barsActive = 1;
  } else {
    barsActive = 0;
  }
  cellBar1.classList.remove('active');
  cellBar2.classList.remove('active');
  cellBar3.classList.remove('active');
  cellBar4.classList.remove('active');

  if (barsActive >= 1) cellBar1.classList.add('active');
  if (barsActive >= 2) cellBar2.classList.add('active');
  if (barsActive >= 3) cellBar3.classList.add('active');
  if (barsActive >= 4) cellBar4.classList.add('active');
}

/* Kullanıcı Kartları => 1,2,3,4,5+ layout */
function renderUsersInMainContent(usersArray) {
  const container = document.getElementById('channelUsersContainer');
  if (!container) return;

  container.innerHTML = '';
  container.classList.remove(
    'layout-1-user','layout-2-users','layout-3-users','layout-4-users','layout-n-users'
  );

  if (usersArray.length === 1) {
    container.classList.add('layout-1-user');
  } else if (usersArray.length === 2) {
    container.classList.add('layout-2-users');
  } else if (usersArray.length === 3) {
    container.classList.add('layout-3-users');
  } else if (usersArray.length === 4) {
    container.classList.add('layout-4-users');
  } else {
    container.classList.add('layout-n-users');
  }

  usersArray.forEach(u => {
    const card = document.createElement('div');
    card.classList.add('user-card');

    const avatar = document.createElement('div');
    avatar.classList.add('user-card-avatar');

    const label = document.createElement('div');
    label.classList.add('user-label');
    label.textContent = u.username || '(İsimsiz)';

    card.appendChild(avatar);
    card.appendChild(label);
    container.appendChild(card);
  });
}

/* =========== Metin Chat Fonksiyonları =========== */
function enableChatUI() {
  textChatArea.style.display = 'block';
}
function disableChatUI() {
  textChatArea.style.display = 'none';
}

// Mesajları ekrana basan helper
function displayChatMessage({ username, content, timestamp }) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('chat-message');
  const timeString = new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  msgDiv.innerHTML = `<strong>[${timeString}] ${username}:</strong> ${content}`;
  chatMessagesDiv.appendChild(msgDiv);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Mesaj gönder butonu
sendChatBtn.addEventListener('click', () => {
  const content = chatInput.value.trim();
  if (!content) return;
  if (!currentRoom) {
    alert("Bir kanalda değilsiniz!");
    return;
  }
  socket.emit('textMessage', {
    channelId: currentRoom,
    content
  });
  chatInput.value = '';
});

// Sunucudan gelen yeni mesaj
socket.on('textMessage', (data) => {
  // Sadece aktif oda (currentRoom) eşleşiyorsa göster
  if (data.channelId === currentRoom) {
    displayChatMessage(data);
  }
});

// Kanal geçmişi
socket.on('channelHistory', (data) => {
  if (data.channelId !== currentRoom) return;
  chatMessagesDiv.innerHTML = '';
  data.messages.forEach(msg => {
    displayChatMessage(msg);
  });
});
w