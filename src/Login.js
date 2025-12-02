import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { useState, useEffect } from "react";

function Login() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (user) {
    return (
      <div style={{ textAlign: "center", padding: "20px" }}>
        <h2>Welcome, {user.displayName}!</h2>
        <img src={user.photoURL} alt="Profile" style={{ borderRadius: "50%", width: "100px" }} />
        <p>{user.email}</p>
        <button onClick={handleSignOut} style={{ padding: "10px 20px", fontSize: "16px" }}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h2>Sign In</h2>
      <button 
        onClick={signInWithGoogle}
        style={{ 
          padding: "10px 20px", 
          fontSize: "16px", 
          backgroundColor: "#4285f4", 
          color: "white", 
          border: "none", 
          borderRadius: "5px",
          cursor: "pointer"
        }}
      >
        Sign in with Google
      </button>
    </div>
  );
}

export default Login;