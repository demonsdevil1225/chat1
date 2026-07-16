(function () {
  const socket = io();

  let currentUser = null;
  let currentRoom = null;
  let roomUsers = [];
  let onlineUsersList = [];
  let deviceStream = null;
  let micGranted = false;
  let camGranted = false;

  // WebRTC state
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let callType = null;
  let callPartnerSocketId = null;
  let callPartnerUserId = null;
  let currentFacingMode = "user";
  let currentZoom = 1;

  // Screen sharing state
  let screenStream = null;
  let isScreenSharing = false;
  let screenShareSender = null;
  let cameraTrackBeforeShare = null;
  let micAudioTrackBeforeShare = null;
  let screenAudioSender = null;

  const ICE_SERVERS = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  };

  // ========== DOM ELEMENTS ==========
  // Auth
  const authScreen = document.getElementById("auth-screen");
  const deviceScreen = document.getElementById("device-screen");
  const appScreen = document.getElementById("app-screen");
  const authTabs = document.querySelectorAll(".auth-tab");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const loginUsername = document.getElementById("login-username");
  const loginPassword = document.getElementById("login-password");
  const loginError = document.getElementById("login-error");
  const regUsername = document.getElementById("reg-username");
  const regPassword = document.getElementById("reg-password");
  const regPasswordConfirm = document.getElementById("reg-password-confirm");
  const registerError = document.getElementById("register-error");

  // Device setup
  const devicePreviewVideo = document.getElementById("device-preview-video");
  const devicePreviewPlaceholder = document.getElementById("device-preview-placeholder");
  const devicePermissionDenied = document.getElementById("device-permission-denied");
  const micStatus = document.getElementById("mic-status");
  const camStatus = document.getElementById("cam-status");
  const deviceAllowBtn = document.getElementById("device-allow-btn");
  const deviceContinueBtn = document.getElementById("device-continue-btn");
  const deviceRetryBtn = document.getElementById("device-retry-btn");
  const deviceSkipBtn = document.getElementById("device-skip-btn");
  const deviceDeniedText = document.getElementById("device-denied-text");

  // App
  const roomList = document.getElementById("room-list");
  const onlineList = document.getElementById("online-list");
  const createRoomBtn = document.getElementById("create-room-btn");
  const roomModal = document.getElementById("room-modal");
  const roomNameInput = document.getElementById("room-name-input");
  const modalCancel = document.getElementById("modal-cancel");
  const modalCreate = document.getElementById("modal-create");
  const currentRoomName = document.getElementById("current-room-name");
  const messagesDiv = document.getElementById("messages");
  const msgInput = document.getElementById("msg-input");
  const sendBtn = document.getElementById("send-btn");
  const imageUploadBtn = document.getElementById("image-upload-btn");
  const imageUploadInput = document.getElementById("image-upload-input");
  const voiceCallBtn = document.getElementById("voice-call-btn");
  const videoCallBtn = document.getElementById("video-call-btn");
  const roomUsersList = document.getElementById("room-users-list");
  const currentUserBadge = document.getElementById("current-user-badge");
  const logoutBtn = document.getElementById("logout-btn");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const mobileUsersBtn = document.getElementById("mobile-users-btn");
  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const roomSidebar = document.getElementById("room-sidebar");
  const usersOverlay = document.getElementById("users-overlay");
  const closeUsersBtn = document.getElementById("close-users-btn");

  // Call
  const callModal = document.getElementById("call-modal");
  const callModalIcon = document.getElementById("call-modal-icon");
  const callModalText = document.getElementById("call-modal-text");
  const callAcceptBtn = document.getElementById("call-accept-btn");
  const callRejectBtn = document.getElementById("call-reject-btn");
  const callPanel = document.getElementById("call-panel");
  const remoteVideo = document.getElementById("remote-video");
  const localVideo = document.getElementById("local-video");
  const callStatusText = document.getElementById("call-status-text");
  const toggleMicBtn = document.getElementById("toggle-mic-btn");
  const toggleCamBtn = document.getElementById("toggle-cam-btn");
  const switchCamBtn = document.getElementById("switch-cam-btn");
  const hangupBtn = document.getElementById("hangup-btn");
  const zoomInBtn = document.getElementById("zoom-in-btn");
  const zoomOutBtn = document.getElementById("zoom-out-btn");
  const fullscreenBtn = document.getElementById("fullscreen-btn");
  const callVideoContainer = document.getElementById("call-video-container");

  // ========== AUTH TABS ==========
  authTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      authTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      loginForm.classList.toggle("active", target === "login");
      registerForm.classList.toggle("active", target === "register");
      loginError.textContent = "";
      registerError.textContent = "";
    });
  });

  // ========== LOGIN ==========
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      loginError.textContent = "Fill in all fields";
      return;
    }
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || "Login failed";
        return;
      }
      currentUser = data;
      goToDeviceSetup();
    } catch {
      loginError.textContent = "Server error. Try again.";
    }
  });

  // ========== REGISTER ==========
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = regUsername.value.trim();
    const password = regPassword.value;
    const confirm = regPasswordConfirm.value;

    if (!username || !password || !confirm) {
      registerError.textContent = "Fill in all fields";
      return;
    }
    if (password !== confirm) {
      registerError.textContent = "Passwords do not match";
      return;
    }
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        registerError.textContent = data.error || "Registration failed";
        return;
      }
      currentUser = data;
      goToDeviceSetup();
    } catch {
      registerError.textContent = "Server error. Try again.";
    }
  });

  // ========== DEVICE SETUP ==========
  function goToDeviceSetup() {
    authScreen.classList.remove("active");
    deviceScreen.classList.add("active");
    resetDeviceUI();
  }

  function resetDeviceUI() {
    micGranted = false;
    camGranted = false;
    micStatus.textContent = "🎤 Microphone — pending";
    micStatus.className = "device-indicator";
    camStatus.textContent = "📷 Camera — pending";
    camStatus.className = "device-indicator";
    devicePermissionDenied.classList.add("hidden");
    devicePreviewPlaceholder.style.display = "";
    devicePreviewVideo.style.display = "none";
    deviceAllowBtn.classList.remove("hidden");
    deviceAllowBtn.disabled = false;
    deviceAllowBtn.textContent = "Allow Camera & Microphone";
    deviceContinueBtn.classList.add("hidden");
    deviceRetryBtn.classList.add("hidden");
    deviceSkipBtn.classList.remove("hidden");

    if (deviceStream) {
      deviceStream.getTracks().forEach((t) => t.stop());
      deviceStream = null;
    }
  }

  async function requestDevices() {
    deviceAllowBtn.disabled = true;
    deviceAllowBtn.textContent = "Requesting access...";
    devicePermissionDenied.classList.add("hidden");

    if (deviceStream) {
      deviceStream.getTracks().forEach((t) => t.stop());
      deviceStream = null;
    }

    // Stop tracks from any previous attempt
    micGranted = false;
    camGranted = false;

    // Step 1: Request audio first (some mobile browsers need this separate)
    let audioStream = null;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micGranted = true;
      micStatus.textContent = "🎤 Microphone — granted";
      micStatus.classList.add("granted");
    } catch (err) {
      console.warn("Audio permission error:", err.name);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        micStatus.textContent = "🎤 Microphone — denied";
      } else if (err.name === "NotFoundError") {
        micStatus.textContent = "🎤 Microphone — not found";
      } else {
        micStatus.textContent = "🎤 Microphone — error: " + err.name;
      }
      micStatus.classList.add("denied");
    }

    // Step 2: Request video
    let videoStream = null;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "user"
        }
      });
      camGranted = true;
      camStatus.textContent = "📷 Camera — granted";
      camStatus.classList.add("granted");
    } catch (err) {
      console.warn("Video permission error:", err.name);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        camStatus.textContent = "📷 Camera — denied";
      } else if (err.name === "NotFoundError") {
        camStatus.textContent = "📷 Camera — not found";
      } else if (err.name === "OverconstrainedError") {
        // Try without facingMode constraint (some phones don't support it)
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          });
          camGranted = true;
          camStatus.textContent = "📷 Camera — granted";
          camStatus.classList.add("granted");
        } catch (err2) {
          camStatus.textContent = "📷 Camera — error";
          camStatus.classList.add("denied");
        }
      } else {
        camStatus.textContent = "📷 Camera — error: " + err.name;
        camStatus.classList.add("denied");
      }
    }

    // Merge streams
    if (audioStream || videoStream) {
      const tracks = [];
      if (audioStream) tracks.push(...audioStream.getTracks());
      if (videoStream) tracks.push(...videoStream.getTracks());
      deviceStream = new MediaStream(tracks);

      // Show preview
      if (camGranted && deviceStream.getVideoTracks().length > 0) {
        devicePreviewVideo.srcObject = deviceStream;
        devicePreviewVideo.style.display = "block";
        devicePreviewPlaceholder.style.display = "none";
      }
    }

    // Update UI based on results
    deviceAllowBtn.classList.add("hidden");
    deviceSkipBtn.classList.add("hidden");

    if (micGranted || camGranted) {
      deviceContinueBtn.classList.remove("hidden");
      deviceRetryBtn.classList.add("hidden");
    } else {
      devicePermissionDenied.classList.remove("hidden");
      deviceDeniedText.textContent = "No devices accessible";
      deviceRetryBtn.classList.remove("hidden");
      deviceContinueBtn.classList.remove("hidden");
      deviceContinueBtn.textContent = "Continue — Text Only";
    }
  }

  deviceAllowBtn.addEventListener("click", requestDevices);
  deviceRetryBtn.addEventListener("click", () => {
    resetDeviceUI();
  });
  deviceSkipBtn.addEventListener("click", enterApp);

  deviceContinueBtn.addEventListener("click", enterApp);

  function enterApp() {
    if (deviceStream) {
      deviceStream.getTracks().forEach((t) => t.stop());
      deviceStream = null;
    }
    deviceScreen.classList.remove("active");
    appScreen.classList.add("active");
    currentUserBadge.textContent = currentUser.username;
    socket.emit("user:join", currentUser);
    loadRooms();
  }

  // ========== LOGOUT ==========
  logoutBtn.addEventListener("click", () => {
    if (currentRoom) socket.emit("room:leave", currentRoom);
    socket.disconnect();
    currentUser = null;
    currentRoom = null;
    roomUsers = [];
    appScreen.classList.remove("active");
    authScreen.classList.add("active");
    loginUsername.value = "";
    loginPassword.value = "";
    regUsername.value = "";
    regPassword.value = "";
    regPasswordConfirm.value = "";
    loginError.textContent = "";
    registerError.textContent = "";
    // Reconnect socket
    socket.connect();
  });

  // ========== MOBILE SIDEBAR TOGGLE ==========
  function openSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("active");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("active");
  }
  function openUsers() {
    roomSidebar.classList.add("open");
    usersOverlay.classList.add("active");
  }
  function closeUsers() {
    roomSidebar.classList.remove("open");
    usersOverlay.classList.remove("active");
  }

  mobileMenuBtn.addEventListener("click", openSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);
  mobileUsersBtn.addEventListener("click", openUsers);
  usersOverlay.addEventListener("click", closeUsers);
  closeUsersBtn.addEventListener("click", closeUsers);

  // ========== ROOMS ==========
  async function loadRooms() {
    try {
      const res = await fetch("/api/rooms");
      const rooms = await res.json();
      roomList.innerHTML = "";
      rooms.forEach((room) => appendRoom(room));
    } catch (err) {
      console.error("Failed to load rooms", err);
    }
  }

  function appendRoom(room) {
    const div = document.createElement("div");
    div.className = "room-item";
    div.dataset.roomId = room.id;
    div.dataset.roomName = room.name;
    
    const nameSpan = document.createElement("span");
    nameSpan.textContent = room.name;
    nameSpan.className = "room-name";
    nameSpan.addEventListener("click", () => joinRoom(room.name));
    div.appendChild(nameSpan);
    
    // Add delete button (only show for room creator or system rooms)
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "room-delete-btn";
    deleteBtn.innerHTML = "✕";
    deleteBtn.title = "Delete room";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete room "${room.name}"? All messages will be lost.`)) {
        deleteRoom(room.id, room.name);
      }
    });
    div.appendChild(deleteBtn);
    
    roomList.appendChild(div);
  }

  createRoomBtn.addEventListener("click", () => {
    roomModal.classList.add("active");
    roomNameInput.value = "";
    roomNameInput.focus();
  });

  modalCancel.addEventListener("click", () => roomModal.classList.remove("active"));
  modalCreate.addEventListener("click", createRoom);
  roomNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createRoom();
  });

  async function createRoom() {
    const name = roomNameInput.value.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, createdBy: currentUser.username }),
      });
      const room = await res.json();
      if (!res.ok) {
        alert(room.error || "Failed to create room");
        return;
      }
      roomModal.classList.remove("active");
      appendRoom(room);
      joinRoom(room.name);
    } catch {
      alert("Server error");
    }
  }

  async function deleteRoom(roomId, roomName) {
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete room");
        return;
      }
      // Remove room from UI
      const roomElement = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
      if (roomElement) {
        roomElement.remove();
      }
      // If we're in the deleted room, go back to General
      if (currentRoom === roomName) {
        joinRoom("General");
      }
    } catch {
      alert("Server error");
    }
  }

  function joinRoom(roomName) {
    if (currentRoom) {
      socket.emit("room:leave", currentRoom);
    }
    currentRoom = roomName;
    currentRoomName.textContent = "# " + roomName;
    messagesDiv.innerHTML = "";
    closeSidebar();
    closeUsers();

    document.querySelectorAll(".room-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.roomName === roomName);
    });

    msgInput.disabled = false;
    sendBtn.disabled = false;
    imageUploadBtn.disabled = false;
    voiceCallBtn.disabled = false;
    videoCallBtn.disabled = false;
    
    // Enable screen share button
    const screenShareBtn = document.getElementById("screen-share-btn");
    if (screenShareBtn) {
      screenShareBtn.disabled = false;
    }

    socket.emit("room:join", roomName);
    loadMessages(roomName);
    requestSeenStatus();
  }

  async function loadMessages(roomName) {
    try {
      const res = await fetch("/api/messages/" + encodeURIComponent(roomName));
      const msgs = await res.json();
      msgs.forEach((msg) => appendMessage(msg));
      scrollBottom();
    } catch (err) {
      console.error("Failed to load messages", err);
    }
  }

  // ========== MESSAGES ==========
  sendBtn.addEventListener("click", sendMessage);
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !currentRoom || !currentUser) return;
    socket.emit("chat:message", {
      room: currentRoom,
      userId: currentUser.id,
      username: currentUser.username,
      text,
    });
    msgInput.value = "";
  }

  // ========== IMAGE UPLOAD ==========
  imageUploadBtn.addEventListener("click", () => imageUploadInput.click());

  imageUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentRoom || !currentUser) return;
    imageUploadInput.value = "";

    const formData = new FormData();
    formData.append("image", file);

    try {
      imageUploadBtn.disabled = true;
      imageUploadBtn.textContent = "⏳";
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      socket.emit("chat:message", {
        room: currentRoom,
        userId: currentUser.id,
        username: currentUser.username,
        text: "",
        type: "image",
        imageUrl: data.url,
      });
    } catch (err) {
      console.error("Image upload failed:", err);
      alert("Failed to upload image. Try a smaller file.");
    } finally {
      imageUploadBtn.disabled = false;
      imageUploadBtn.textContent = "🖼️";
    }
  });

  function deleteMessage(msgId) {
    if (!currentRoom || !confirm("Delete this message?")) return;
    socket.emit("chat:delete", { id: msgId, room: currentRoom });
  }

  socket.on("chat:deleted", ({ id }) => {
    const el = document.querySelector(`.message[data-msg-id="${id}"]`);
    if (el) el.remove();
    const qel = document.querySelector(`.quick-chat-messages .message[data-msg-id="${id}"]`);
    if (qel) qel.remove();
  });

  socket.on("chat:message", (msg) => {
    appendMessage(msg);
    scrollBottom();
  });

  function appendMessage(msg) {
    const div = document.createElement("div");
    const isOwn = msg.userId === currentUser?.id;
    div.className =
      "message " +
      (msg.type === "system" ? "system" : isOwn ? "own" : "other");
    div.setAttribute("data-msg-id", msg.id);

    if (msg.type === "system") {
      div.textContent = msg.text;
    } else {
      const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      let contentHtml = '<div class="msg-author">' + escapeHtml(msg.username) + "</div>";

      if (msg.type === "image" && msg.imageUrl) {
        contentHtml += '<div class="msg-image"><img src="' + msg.imageUrl + '" alt="shared image" loading="lazy" /></div>';
      }

      if (msg.text) {
        contentHtml += "<div>" + escapeHtml(msg.text) + "</div>";
      }

      if (isOwn) {
        contentHtml += '<button class="msg-delete-btn" title="Delete">🗑️</button>';
      }

      contentHtml += '<div class="msg-time">' + time + "</div>";
      div.innerHTML = contentHtml;

      if (isOwn) {
        div.querySelector(".msg-delete-btn").addEventListener("click", () => deleteMessage(msg.id));
      }
    }
    messagesDiv.appendChild(div);
  }

  function scrollBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ========== ONLINE USERS ==========
  socket.on("users:online", (users) => {
    onlineUsersList = users;
    onlineList.innerHTML = "";
    users.forEach((u) => {
      const div = document.createElement("div");
      div.className = "online-item";
      div.innerHTML =
        '<span class="online-dot"></span>' + escapeHtml(u.username);
      onlineList.appendChild(div);
    });
  });

  // ========== ROOM USERS ==========
  socket.on("room:users", (users) => {
    roomUsers = users;
    roomUsersList.innerHTML = "";
    users.forEach((u) => {
      const div = document.createElement("div");
      div.className = "room-user-item";
      div.innerHTML =
        '<span class="online-dot"></span>' + escapeHtml(u.username);
      if (u.id === currentUser.id) {
        div.innerHTML += " <em>(you)</em>";
      }
      roomUsersList.appendChild(div);
    });
    updateCallButtons();
  });

  function updateCallButtons() {
    const canCall = currentRoom && roomUsers.length > 1;
    voiceCallBtn.disabled = !canCall;
    videoCallBtn.disabled = !canCall;
  }

  // ========== WEBRTC CALLS ==========
  voiceCallBtn.addEventListener("click", () => startCall("voice"));
  videoCallBtn.addEventListener("click", () => startCall("video"));
  callAcceptBtn.addEventListener("click", acceptCall);
  callRejectBtn.addEventListener("click", rejectCall);
  hangupBtn.addEventListener("click", hangUp);
  toggleMicBtn.addEventListener("click", toggleMic);
  toggleCamBtn.addEventListener("click", toggleCam);
  switchCamBtn.addEventListener("click", switchCamera);
  zoomInBtn.addEventListener("click", zoomIn);
  zoomOutBtn.addEventListener("click", zoomOut);
  fullscreenBtn.addEventListener("click", toggleFullscreen);
  
  // Screen share buttons
  const screenShareBtn = document.getElementById("screen-share-btn");
  const toggleScreenBtn = document.getElementById("toggle-screen-btn");
  
  if (screenShareBtn) {
    screenShareBtn.addEventListener("click", () => {
      if (isScreenSharing) {
        stopScreenShare();
      } else {
        startScreenShare();
      }
    });
  }
  
  if (toggleScreenBtn) {
    toggleScreenBtn.addEventListener("click", () => {
      if (isScreenSharing) {
        stopScreenShare();
      } else {
        startScreenShare();
      }
    });
  }

  // Drag local video PIP
  makeDraggable(localVideo, callVideoContainer);

  function getMediaConstraints(type) {
    if (type === "video") {
      return {
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 60, max: 60 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        }
      };
    }
    return {
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 2
      }
    };
  }

  async function getLocalStream(type) {
    if (localStream && localStream.active) {
      return localStream;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia(
        getMediaConstraints(type)
      );
      localVideo.srcObject = localStream;
      return localStream;
    } catch (err) {
      console.error("getUserMedia failed:", err);
      // Mobile fallback: try audio and video separately
      if (type === "video") {
        try {
          const audioS = await navigator.mediaDevices.getUserMedia({ audio: true });
          const videoS = await navigator.mediaDevices.getUserMedia({ video: true });
          const combined = new MediaStream([
            ...audioS.getTracks(),
            ...videoS.getTracks(),
          ]);
          localStream = combined;
          localVideo.srcObject = localStream;
          return localStream;
        } catch (err2) {
          console.error("Fallback getUserMedia also failed:", err2);
        }
      }
      alert("Could not access camera/microphone. Check your browser permissions.");
      return null;
    }
  }

  function createPeerConnection(targetUserId) {
    peerConnection = new RTCPeerConnection(ICE_SERVERS);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("call:ice-candidate", {
          to: targetUserId,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0];
      remoteVideo.srcObject = remoteStream;
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      callStatusText.textContent =
        state === "connected"
          ? "Connected"
          : state === "disconnected" || state === "failed"
          ? "Disconnected"
          : "Connecting...";
      if (state === "failed" || state === "disconnected") {
        hangUp();
      }
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    }

    return peerConnection;
  }

  async function setHDParameters(pc) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) {
      const params = sender.getParameters();
      if (!params.encodings) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 5000000; // 5 Mbps for 1080p
      params.encodings[0].maxFramerate = 60;
      params.encodings[0].scaleResolutionDownBy = 1;
      await sender.setParameters(params);
    }
  }

  async function startCall(type) {
    if (!currentRoom || !currentUser) return;

    const target = roomUsers.find((u) => u.id !== currentUser.id);
    if (!target) {
      alert("No one else in the room to call.");
      return;
    }

    callType = type;
    callPartnerUserId = target.id;

    const stream = await getLocalStream(type);
    if (!stream) return;

    localVideo.style.display = type === "video" ? "block" : "none";
    remoteVideo.style.display = type === "video" ? "block" : "none";
    showCallPanel(type, "Calling...");

    const pc = createPeerConnection(target.id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Set HD parameters
    await setHDParameters(pc);

    const plainOffer = { type: offer.type, sdp: offer.sdp };
    console.log("Sending call:offer to", target.id, "roomUsers:", roomUsers.map(u => u.id));
    socket.emit("call:offer", {
      to: target.id,
      from: currentUser.id,
      offer: plainOffer,
      callType: type,
    });
  }

  // Callee state
  let pendingOffer = null;
  let pendingCallerSocketId = null;
  let pendingCallerUserId = null;
  let pendingCallType = null;
  let bufferedIceCandidates = [];

  socket.on(
    "call:offer",
    async ({ from, offer, callType: type, callerSocketId, callerUserId }) => {
      console.log("Received call:offer from", from, "type:", type, "offer:", !!offer);
      pendingOffer = offer;
      pendingCallerSocketId = callerSocketId;
      pendingCallerUserId = callerUserId;
      pendingCallType = type;
      bufferedIceCandidates = [];

      callModalIcon.textContent = type === "video" ? "📹" : "🎤";
      callModalText.textContent =
        "Incoming " + type + " call...";
      callModal.classList.add("active");
    }
  );

  async function acceptCall() {
    callModal.classList.remove("active");

    callType = pendingCallType;
    callPartnerSocketId = pendingCallerSocketId;
    callPartnerUserId = pendingCallerUserId;

    const stream = await getLocalStream(callType);
    if (!stream) return;

    localVideo.style.display = callType === "video" ? "block" : "none";
    remoteVideo.style.display = callType === "video" ? "block" : "none";
    showCallPanel(callType, "Connecting...");

    const pc = createPeerConnection(pendingCallerUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    // Set HD parameters
    await setHDParameters(pc);

    socket.emit("call:answer", {
      to: pendingCallerUserId,
      from: currentUser.id,
      answer,
    });

    // Flush any buffered ICE candidates
    bufferedIceCandidates.forEach((candidate) => {
      try {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) { /* ignore */ }
    });
    bufferedIceCandidates = [];
  }

  function rejectCall() {
    callModal.classList.remove("active");
    if (pendingCallerUserId) {
      socket.emit("call:hangup", { to: pendingCallerUserId });
    }
    pendingOffer = null;
    pendingCallerSocketId = null;
    pendingCallerUserId = null;
    pendingCallType = null;
  }

  socket.on("call:answer", async ({ from, answer, socketId }) => {
    callPartnerSocketId = socketId;
    if (peerConnection) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    }
  });

  socket.on("call:ice-candidate", async ({ candidate, socketId }) => {
    if (candidate) {
      if (peerConnection) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Error adding ICE candidate:", err);
        }
      } else {
        bufferedIceCandidates.push(candidate);
      }
    }
  });

  socket.on("call:hangup", () => {
    cleanupCall();
  });

  function hangUp() {
    if (callPartnerUserId) {
      socket.emit("call:hangup", { to: callPartnerUserId });
    }
    cleanupCall();
  }

  function cleanupCall() {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
    isScreenSharing = false;
    screenShareSender = null;
    screenAudioSender = null;
    cameraTrackBeforeShare = null;
    micAudioTrackBeforeShare = null;
    updateScreenShareUI(false);
    
    remoteStream = null;
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    callPartnerSocketId = null;
    callPartnerUserId = null;
    callType = null;
    currentZoom = 1;
    currentFacingMode = "user";
    remoteVideo.style.transform = "";
    localVideo.style.left = "";
    localVideo.style.top = "";
    localVideo.style.right = "";
    localVideo.style.bottom = "";
    callPanel.classList.add("hidden");
    floatChatBtn.classList.remove("visible");
    floatChatBtn.classList.remove("active");
    quickChatOverlay.classList.remove("active");
    callChatPanel.classList.add("hidden");
    callChatMessages.innerHTML = "";
  }

  function showCallPanel(type, status) {
    callType = type;
    callPanel.classList.remove("hidden");
    floatChatBtn.classList.add("visible");
    callStatusText.textContent = status;
    localVideo.style.display = type === "video" ? "block" : "none";
    remoteVideo.style.display = type === "video" ? "block" : "none";
  }

  // ========== SCREEN SHARING ==========
  async function startScreenShare() {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        },
        selfBrowserSurface: "include",
        systemAudio: "include"
      });

      const screenVideoTrack = screenStream.getVideoTracks()[0];
      const screenAudioTracks = screenStream.getAudioTracks();
      const screenAudioTrack = screenAudioTracks[0] || null;
      
      console.log("Screen share started — video:", !!screenVideoTrack, "audio tracks:", screenAudioTracks.length);
      if (screenAudioTrack) {
        console.log("Screen audio track:", screenAudioTrack.label);
      } else {
        console.warn("No screen audio captured. Make sure you checked 'Share audio' and shared a browser TAB (not a window).");
      }
      
      // Save current camera track for reverting
      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
          cameraTrackBeforeShare = videoTrack;
        }
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          micAudioTrackBeforeShare = audioTrack;
        }
      }

      // If not in a call, start one automatically
      if (!peerConnection) {
        const target = roomUsers.find((u) => u.id !== currentUser.id);
        if (!target) {
          // No one else in room - just share locally
          localVideo.srcObject = screenStream;
          localVideo.style.display = "block";
          isScreenSharing = true;
          updateScreenShareUI(true);
          screenVideoTrack.onended = () => { stopScreenShare(); };
          alert("Screen sharing started locally. Others need to join for them to see it.");
          return;
        }
        
        // Start a video call with screen sharing
        callType = "video";
        callPartnerUserId = target.id;
        
        // Get camera stream for audio
        const stream = await getLocalStream("video");
        if (!stream) {
          screenStream.getTracks().forEach(t => t.stop());
          screenStream = null;
          return;
        }
        
        // Create peer connection
        const pc = createPeerConnection(target.id);
        
        // Replace camera video track with screen track on the sender
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(screenVideoTrack);
        }

        // Replace mic audio with screen audio on the audio sender
        if (screenAudioTrack) {
          const audioSnd = pc.getSenders().find(s => s.track && s.track.kind === "audio");
          if (audioSnd) {
            await audioSnd.replaceTrack(screenAudioTrack);
            screenAudioSender = audioSnd;
          }
        }
        
        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await setHDParameters(pc);
        
        socket.emit("call:offer", {
          to: target.id,
          from: currentUser.id,
          offer: { type: offer.type, sdp: offer.sdp },
          callType: "video",
        });
        
        localVideo.srcObject = screenStream;
        localVideo.style.display = "block";
        remoteVideo.style.display = "block";
        showCallPanel("video", "Sharing Screen...");
      } else {
        // Already in a call - replace video track
        screenShareSender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
        if (screenShareSender) {
          await screenShareSender.replaceTrack(screenVideoTrack);
        }

        // Replace mic audio with screen audio
        if (screenAudioTrack) {
          const audioSnd = peerConnection.getSenders().find(s => s.track && s.track.kind === "audio");
          if (audioSnd) {
            await audioSnd.replaceTrack(screenAudioTrack);
            screenAudioSender = audioSnd;
          }
        }

        localVideo.srcObject = screenStream;
        localVideo.style.display = "block";
      }
      
      isScreenSharing = true;
      updateScreenShareUI(true);
      screenVideoTrack.onended = () => { stopScreenShare(); };
      console.log("Screen sharing active — audio:", screenAudioTrack ? "YES (" + screenAudioTrack.label + ")" : "NO (re-share a tab with 'Share audio' checked)");
    } catch (err) {
      console.error("Screen share failed:", err);
      if (err.name !== "AbortError") {
        alert("Could not start screen sharing. Check your browser permissions.");
      }
    }
  }

  async function stopScreenShare() {
    if (!isScreenSharing) return;

    // Stop screen stream tracks
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    // Revert to camera track
    if (screenShareSender && cameraTrackBeforeShare) {
      try {
        await screenShareSender.replaceTrack(cameraTrackBeforeShare);
      } catch (err) {
        console.error("Failed to revert to camera:", err);
      }
    }

    // Revert to mic audio track
    if (screenAudioSender && micAudioTrackBeforeShare) {
      try {
        await screenAudioSender.replaceTrack(micAudioTrackBeforeShare);
      } catch (err) {
        console.error("Failed to revert to mic audio:", err);
      }
    }

    // Update local video back to camera
    if (localStream && callType === "video") {
      localVideo.srcObject = localStream;
    }

    isScreenSharing = false;
    screenShareSender = null;
    screenAudioSender = null;
    cameraTrackBeforeShare = null;
    micAudioTrackBeforeShare = null;
    updateScreenShareUI(false);

    console.log("Screen sharing stopped");
  }

  function updateScreenShareUI(sharing) {
    const screenShareBtn = document.getElementById("screen-share-btn");
    const toggleScreenBtn = document.getElementById("toggle-screen-btn");
    
    if (screenShareBtn) {
      screenShareBtn.classList.toggle("sharing", sharing);
      screenShareBtn.title = sharing ? "Stop Sharing" : "Share Screen";
    }
    if (toggleScreenBtn) {
      toggleScreenBtn.classList.toggle("sharing", sharing);
      toggleScreenBtn.title = sharing ? "Stop Sharing" : "Share Screen";
    }
  }

  function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleMicBtn.classList.toggle("muted", !audioTrack.enabled);
      toggleMicBtn.textContent = audioTrack.enabled ? "🎤" : "🔇";
    }
  }

  function toggleCam() {
    if (!localStream || callType !== "video") return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleCamBtn.classList.toggle("muted", !videoTrack.enabled);
      toggleCamBtn.textContent = videoTrack.enabled ? "📹" : "📷";
    }
  }

  // ========== SWITCH CAMERA ==========
  async function switchCamera() {
    if (!localStream || callType !== "video") return;

    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 60, max: 60 },
          facingMode: currentFacingMode
        },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = localStream.getVideoTracks()[0];

      // Replace track on peer connection
      if (peerConnection) {
        const sender = peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }

      // Stop old track, add new one to local stream
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        localStream.removeTrack(oldVideoTrack);
      }
      localStream.addTrack(newVideoTrack);
      localVideo.srcObject = localStream;

      // Animate the switch
      localVideo.style.transition = "transform 0.3s";
      localVideo.style.transform = "scaleX(0)";
      setTimeout(() => {
        localVideo.style.transform = "scaleX(1)";
      }, 150);
    } catch (err) {
      console.error("Switch camera failed:", err);
      currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    }
  }

  // ========== ZOOM ==========
  function zoomIn() {
    currentZoom = Math.min(currentZoom + 0.25, 3);
    applyZoom();
  }

  function zoomOut() {
    currentZoom = Math.max(currentZoom - 0.25, 1);
    applyZoom();
  }

  function applyZoom() {
    remoteVideo.style.transform = "scale(" + currentZoom + ")";
    remoteVideo.style.transformOrigin = "center center";
  }

  // ========== FULLSCREEN ==========
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      callPanel.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  document.addEventListener("fullscreenchange", () => {
    fullscreenBtn.textContent = document.fullscreenElement ? "⛶" : "⛶";
  });

  // ========== DRAGGABLE LOCAL VIDEO ==========
  function makeDraggable(el, container) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    function onPointerDown(e) {
      if (e.target !== el) return;
      isDragging = true;
      startX = e.clientX || (e.touches && e.touches[0].clientX);
      startY = e.clientY || (e.touches && e.touches[0].clientY);
      const rect = el.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      el.style.transition = "none";
      el.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const cx = e.clientX || (e.touches && e.touches[0].clientX);
      const cy = e.clientY || (e.touches && e.touches[0].clientY);
      const dx = cx - startX;
      const dy = cy - startY;

      const containerRect = container.getBoundingClientRect();
      let newX = initialX + dx - containerRect.left;
      let newY = initialY + dy - containerRect.top;

      // Clamp within container
      newX = Math.max(0, Math.min(newX, containerRect.width - el.offsetWidth));
      newY = Math.max(0, Math.min(newY, containerRect.height - el.offsetHeight));

      el.style.left = newX + "px";
      el.style.top = newY + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    }

    function onPointerUp() {
      isDragging = false;
      el.style.transition = "";
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    // Touch support
    el.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      onPointerDown({ clientX: touch.clientX, clientY: touch.clientY, target: el, preventDefault: () => {} });
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      const touch = e.touches[0];
      onPointerMove({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} });
    }, { passive: false });
    el.addEventListener("touchend", onPointerUp);
  }

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
    cleanupCall();
  });

  // Handle room deletion from server
  socket.on("room:deleted", ({ roomName, roomId }) => {
    const roomElement = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
    if (roomElement) {
      roomElement.remove();
    }
    // If we're in the deleted room, go back to General
    if (currentRoom === roomName) {
      alert("This room has been deleted.");
      joinRoom("General");
    }
  });

  // ========== IN-CALL CHAT ==========
  const callChatBtn = document.getElementById("call-chat-btn");
  const callChatPanel = document.getElementById("call-chat-panel");
  const callChatClose = document.getElementById("call-chat-close");
  const callChatMessages = document.getElementById("call-chat-messages");
  const callChatInput = document.getElementById("call-chat-input");
  const callChatSend = document.getElementById("call-chat-send");

  callChatBtn.addEventListener("click", () => {
    callChatPanel.classList.toggle("hidden");
  });

  callChatClose.addEventListener("click", () => {
    callChatPanel.classList.add("hidden");
  });

  function sendCallChatMessage() {
    const text = callChatInput.value.trim();
    if (!text || !callPartnerUserId) return;
    socket.emit("call:chat-message", {
      to: callPartnerUserId,
      text,
      callId: currentRoom,
    });
    callChatInput.value = "";
  }

  callChatSend.addEventListener("click", sendCallChatMessage);
  callChatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendCallChatMessage();
  });

  socket.on("call:chat-message", (msg) => {
    const div = document.createElement("div");
    const isOwn = msg.self || msg.userId === currentUser?.id;
    div.className = "call-chat-msg " + (isOwn ? "own" : "other");
    const time = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    div.innerHTML =
      (isOwn ? "" : '<div class="call-chat-author">' + escapeHtml(msg.username) + "</div>") +
      "<div>" + escapeHtml(msg.text) + "</div>" +
      '<div class="call-chat-time">' + time + "</div>";
    callChatMessages.appendChild(div);
    callChatMessages.scrollTop = callChatMessages.scrollHeight;
  });

  // ========== SEEN RECEIPTS ==========
  let lastSeenMsgId = null;
  let seenStatusMap = {}; // { userId: { lastMsgId, seenAt } }

  function emitSeen() {
    if (!currentRoom || !currentUser) return;
    const msgs = messagesDiv.querySelectorAll(".message[data-msg-id]");
    if (msgs.length === 0) return;
    const lastMsg = msgs[msgs.length - 1];
    const lastMsgId = lastMsg.getAttribute("data-msg-id");
    if (lastMsgId !== lastSeenMsgId) {
      lastSeenMsgId = lastMsgId;
      socket.emit("messages:seen", {
        room: currentRoom,
        userId: currentUser.id,
        lastMsgId,
      });
    }
  }

  socket.on("messages:seen", ({ userId, username, lastMsgId }) => {
    seenStatusMap[userId] = { lastMsgId, username };
    updateSeenIndicators();
  });

  socket.on("messages:get-seen", ({ room, seen }) => {
    seen.forEach(({ userId, username, lastMsgId }) => {
      seenStatusMap[userId] = { lastMsgId, username };
    });
    updateSeenIndicators();
  });

  function updateSeenIndicators() {
    // Remove old indicators
    messagesDiv.querySelectorAll(".msg-seen").forEach((el) => el.remove());

    // Get own messages
    const ownMsgs = messagesDiv.querySelectorAll(".message.own[data-msg-id]");
    if (ownMsgs.length === 0) return;

    const lastOwnMsg = ownMsgs[ownMsgs.length - 1];
    const lastOwnMsgId = lastOwnMsg.getAttribute("data-msg-id");

    // Find the earliest "seen by" — anyone who has seen at least up to lastOwnMsgId
    let seenByUsers = [];
    for (const [userId, info] of Object.entries(seenStatusMap)) {
      if (userId === currentUser.id) continue;
      if (!info.lastMsgId) continue;
      // Check if this user has seen up to or past our last message
      const allOwnIds = Array.from(ownMsgs).map((m) =>
        m.getAttribute("data-msg-id")
      );
      const seenIdx = allOwnIds.indexOf(info.lastMsgId);
      if (seenIdx >= 0) {
        seenByUsers.push(info.username);
      }
    }

    if (seenByUsers.length > 0) {
      const seenEl = document.createElement("div");
      seenEl.className = "msg-seen";
      seenEl.textContent =
        "Seen by " + seenByUsers.join(", ");
      lastOwnMsg.appendChild(seenEl);
    }
  }

  // Track scroll and visibility for seen
  messagesDiv.addEventListener("scroll", () => {
    const atBottom =
      messagesDiv.scrollHeight - messagesDiv.scrollTop <
      messagesDiv.clientHeight + 100;
    if (atBottom) emitSeen();
  });

  // When a message arrives, emit seen after a short delay
  const origAppendMessage = appendMessage;
  function appendMessageWithSeen(msg) {
    origAppendMessage(msg);
    if (msg.userId !== currentUser?.id && msg.type !== "system") {
      setTimeout(emitSeen, 500);
    }
    updateSeenIndicators();
  }
  // Replace appendMessage references for incoming messages
  socket.off("chat:message");
  socket.on("chat:message", (msg) => {
    appendMessageWithSeen(msg);
    scrollBottom();
  });

  // Request seen status when joining a room
  function requestSeenStatus() {
    if (!currentRoom) return;
    socket.emit("messages:get-seen", { room: currentRoom });
  }

  // ========== FLOATING CHAT ==========
  const floatChatBtn = document.getElementById("float-chat-btn");
  const quickChatOverlay = document.getElementById("quick-chat-overlay");
  const closeQuickChat = document.getElementById("close-quick-chat");
  const quickChatMessages = document.getElementById("quick-chat-messages");
  const quickChatInput = document.getElementById("quick-chat-input");
  const quickChatSend = document.getElementById("quick-chat-send");

  floatChatBtn.addEventListener("click", () => {
    quickChatOverlay.classList.toggle("active");
    floatChatBtn.classList.toggle("active");
    if (quickChatOverlay.classList.contains("active")) {
      quickChatInput.focus();
    }
  });

  closeQuickChat.addEventListener("click", () => {
    quickChatOverlay.classList.remove("active");
    floatChatBtn.classList.remove("active");
  });

  function sendQuickChatMessage() {
    const text = quickChatInput.value.trim();
    if (!text || !currentRoom || !currentUser) return;
    socket.emit("chat:message", {
      room: currentRoom,
      userId: currentUser.id,
      username: currentUser.username,
      text,
    });
    quickChatInput.value = "";
  }

  quickChatSend.addEventListener("click", sendQuickChatMessage);
  quickChatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendQuickChatMessage();
  });

  // Listen for messages in quick chat
  socket.on("chat:message", (msg) => {
    if (quickChatOverlay.classList.contains("active")) {
      appendQuickChatMessage(msg);
      quickChatMessages.scrollTop = quickChatMessages.scrollHeight;
    }
  });

  function appendQuickChatMessage(msg) {
    const div = document.createElement("div");
    const isOwn = msg.userId === currentUser?.id;
    div.className =
      "message " +
      (msg.type === "system" ? "system" : isOwn ? "own" : "other");
    div.setAttribute("data-msg-id", msg.id);

    if (msg.type === "system") {
      div.textContent = msg.text;
    } else {
      const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      let contentHtml = '<div class="msg-author">' + escapeHtml(msg.username) + "</div>";

      if (msg.type === "image" && msg.imageUrl) {
        contentHtml += '<div class="msg-image"><img src="' + msg.imageUrl + '" alt="shared image" loading="lazy" /></div>';
      }

      if (msg.text) {
        contentHtml += "<div>" + escapeHtml(msg.text) + "</div>";
      }

      if (isOwn) {
        contentHtml += '<button class="msg-delete-btn" title="Delete">🗑️</button>';
      }

      contentHtml += '<div class="msg-time">' + time + "</div>";
      div.innerHTML = contentHtml;

      if (isOwn) {
        div.querySelector(".msg-delete-btn").addEventListener("click", () => deleteMessage(msg.id));
      }
    }
    quickChatMessages.appendChild(div);
  }
})();
