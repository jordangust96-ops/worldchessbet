// Remembers where to send the user after they finish authenticating (login,
// register, or MFA verify), so opening a private match invite link while
// logged out returns them straight back to that invitation instead of Home.
const KEY = "chessbet_post_auth_redirect";

export function setPostAuthRedirect(path) {
  sessionStorage.setItem(KEY, path);
}

export function getPostAuthRedirect() {
  return sessionStorage.getItem(KEY);
}

export function clearPostAuthRedirect() {
  sessionStorage.removeItem(KEY);
}