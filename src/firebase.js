import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAt-VZ-2PwrlDpWR19klPY8A_p9lCmqkss",
  authDomain: "blahbluh-635aa.firebaseapp.com",
  projectId: "blahbluh-635aa",
  storageBucket: "blahbluh-635aa.firebasestorage.app",
  messagingSenderId: "908848825760",
  appId: "1:908848825760:web:d2e7cd6874806a0a50d0c5",
  measurementId: "G-NPRHS0TXB5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();