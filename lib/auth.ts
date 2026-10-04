/**
 * Supabase Auth API for Avelut.
 */
export {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  type AuthUser,
} from './backend';
