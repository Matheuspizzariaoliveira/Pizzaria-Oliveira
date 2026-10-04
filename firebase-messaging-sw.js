/* Firebase Cloud Messaging service worker
   A configuração será preenchida após a criação do projeto Firebase.
   Nunca coloque aqui uma Service Account ou chave privada.
*/
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey: "COLOQUE_AQUI",
  authDomain: "COLOQUE_AQUI",
  projectId: "COLOQUE_AQUI",
  storageBucket: "COLOQUE_AQUI",
  messagingSenderId: "COLOQUE_AQUI",
  appId: "COLOQUE_AQUI"
};

if (FIREBASE_CONFIG.apiKey !== "COLOQUE_AQUI") {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "Novo pedido - Pizzaria Oliveira";
    const body = payload.notification?.body || "Você recebeu um novo pedido.";
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: "/" }
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});