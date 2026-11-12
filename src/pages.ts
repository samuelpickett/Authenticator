// This file contains AI-generated code.
import type { ProfileView, SessionView } from './auth.js';

/** Escapes account and configuration text before embedding it in HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** Wraps the built-in page content and allows one trusted site stylesheet. */
function layout(title: string, content: string, basePath: string, customCssUrl?: string): string {
  const css = customCssUrl ? `<link rel="stylesheet" href="${escapeHtml(customCssUrl)}">` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${basePath}/assets/default.css">${css}
<script src="${basePath}/assets/app.js" defer></script></head>
<body><main class="auth-shell"><div class="auth-card"><header><p class="eyebrow">Account</p><h1>${escapeHtml(title)}</h1></header>
<div id="message" role="status" aria-live="polite"></div>${content}</div></main></body></html>`;
}

/** Displays sign-in with a server-approved destination after authentication. */
export function loginPage(basePath: string, nextPath: string, customCssUrl?: string): string {
  return layout('Sign in', `<form data-api="${basePath}/api/login" data-next="${escapeHtml(nextPath)}">
    <label>Login username<input name="username" autocomplete="username" required maxlength="256"></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Sign in</button></form>
    <p class="links"><a href="${basePath}/register">Create an account</a><a href="${basePath}/forgot">Forgot password?</a></p>
    <p class="links"><a href="${basePath}/resend">Resend verification email</a></p>`, basePath, customCssUrl);
}

/** Displays separate account and first-profile names during registration. */
export function registerPage(basePath: string, customCssUrl?: string): string {
  return layout('Create an account', `<p>One login can hold several profiles. Choose the name you will sign in with and a name for your first profile.</p>
    <form data-api="${basePath}/api/register">
    <label>Login username<input name="username" autocomplete="username" required></label>
    <label>Email<input name="email" type="email" autocomplete="email" required></label>
    <label>Password <span class="hint">At least 15 characters</span><input name="password" type="password" autocomplete="new-password" minlength="15" required></label>
    <label>First profile name<input name="profileUsername" required></label>
    <button type="submit">Create account</button></form>
    <p class="links"><a href="${basePath}/login">Already registered? Sign in</a></p>`, basePath, customCssUrl);
}

/** Displays a simple email request for verification or recovery. */
export function emailRequestPage(kind: 'forgot' | 'resend', basePath: string, customCssUrl?: string): string {
  const title = kind === 'forgot' ? 'Reset your password' : 'Resend verification';
  const endpoint = kind === 'forgot' ? 'forgot' : 'resend';
  return layout(title, `<p>If the address belongs to an eligible account, we will send a link.</p>
    <form data-api="${basePath}/api/${endpoint}"><label>Email<input name="email" type="email" autocomplete="email" required></label>
    <button type="submit">Send link</button></form><p class="links"><a href="${basePath}/login">Back to sign in</a></p>`, basePath, customCssUrl);
}

/** Displays a password form bound to the one-use URL token. */
export function resetPage(token: string, basePath: string, customCssUrl?: string): string {
  return layout('Choose a new password', `<form data-api="${basePath}/api/reset" data-next="${basePath}/login">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>New password <span class="hint">At least 15 characters</span><input name="password" type="password" autocomplete="new-password" minlength="15" required></label>
    <button type="submit">Reset password</button></form>`, basePath, customCssUrl);
}

/** Confirms a mail link before continuing toward the site's chosen page. */
export function confirmationPage(kind: 'verify' | 'email', token: string, basePath: string, customCssUrl?: string): string {
  const title = kind === 'verify' ? 'Verify your email' : 'Confirm your new email';
  return layout(title, `<p>Select Confirm to complete this change. You may need to sign in before reaching your account page.</p>
    <form data-api="${basePath}/api/${kind}" data-next="${basePath}/continue"><input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit">Confirm</button></form>`, basePath, customCssUrl);
}

/** Displays the account settings and every profile owned by the account. */
export function profilePage(session: SessionView, profiles: ProfileView[], basePath: string, customCssUrl?: string, allowDelete = false): string {
  const profileList = profiles.map((profile) => `<li class="profile-item">
    <div><strong>${escapeHtml(profile.username)}</strong>${profile.id === session.activeProfileId ? ' <span class="badge">Active</span>' : ''}</div>
    <div class="profile-actions">
      ${profile.id === session.activeProfileId ? '' : `<form data-api="${basePath}/api/profiles/${profile.id}/switch" data-next="${basePath}/profile"><button class="secondary" type="submit">Switch</button></form>`}
      <form data-api="${basePath}/api/profiles/${profile.id}/rename" data-next="${basePath}/profile"><label class="sr-only" for="rename-${profile.id}">Rename profile</label><input id="rename-${profile.id}" name="username" value="${escapeHtml(profile.username)}" required><button class="secondary" type="submit">Rename</button></form>
      ${allowDelete && profiles.length > 1 ? `<form data-api="${basePath}/api/profiles/${profile.id}/delete" data-confirm="Delete this profile and its associated site data?" data-next="${basePath}/profile"><button class="danger" type="submit">Delete</button></form>` : ''}
    </div></li>`).join('');
  return layout('Your account', `<p>Signed in as <strong>${escapeHtml(session.loginUsername)}</strong>. Active profile: <strong>${escapeHtml(session.activeProfileUsername)}</strong>.</p>
    <section><h2>Profiles</h2><ul class="profile-list">${profileList}</ul>
    <form data-api="${basePath}/api/profiles" data-next="${basePath}/profile"><label>New profile name<input name="username" required></label><button type="submit">Create profile</button></form></section>
    <section><h2>Account settings</h2><p>Email: <strong>${escapeHtml(session.email)}</strong></p>
    <p class="hint">Enter your current password only for the change you are making. This protects account details if someone else has access to an open session.</p>
    <form data-api="${basePath}/api/account/username" data-next="${basePath}/profile"><label>New login username<input name="username" value="${escapeHtml(session.loginUsername)}" required></label><label>Current password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Change login username</button></form>
    <form data-api="${basePath}/api/account/email"><label>New email<input name="email" type="email" required></label><label>Current password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Send confirmation</button></form>
    <form data-api="${basePath}/api/account/password" data-next="${basePath}/login"><label>Current password<input name="oldPassword" type="password" autocomplete="current-password" required></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="15" required></label><button type="submit">Change password</button></form></section>
    <form data-api="${basePath}/api/logout" data-next="${basePath}/login"><button class="secondary" type="submit">Sign out</button></form>`, basePath, customCssUrl);
}

/** Shows a safe outcome for an email confirmation link. */
export function resultPage(title: string, message: string, basePath: string, customCssUrl?: string): string {
  return layout(title, `<p>${escapeHtml(message)}</p><p class="links"><a href="${basePath}/login">Sign in</a></p>`, basePath, customCssUrl);
}

export const defaultCss = `/* AI-generated code */
:root{--auth-bg:#f3f6fa;--auth-surface:#fff;--auth-ink:#172333;--auth-accent:#2456ad;--auth-border:#dce3ed;--auth-muted:#52657d;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:var(--auth-ink);background:var(--auth-bg);line-height:1.5}
*{box-sizing:border-box}body{margin:0}.auth-shell{min-height:100vh;display:grid;place-items:center;padding:2rem 1rem}.auth-card{width:min(100%,650px);background:var(--auth-surface);border:1px solid var(--auth-border);border-radius:14px;box-shadow:0 12px 35px #17233312;padding:2rem}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--auth-muted);font-size:.75rem;font-weight:700;margin:0}h1{margin:.2rem 0 1.5rem;font-size:1.8rem}h2{font-size:1.2rem;margin:0 0 1rem}p{margin:0 0 1rem}section{border-top:1px solid var(--auth-border);margin-top:1.8rem;padding-top:1.5rem}form{display:grid;gap:.85rem;margin:1rem 0}label{display:grid;gap:.35rem;font-weight:600}input{font:inherit;width:100%;border:1px solid #aab8c9;border-radius:7px;padding:.65rem .75rem;color:inherit}input:focus{outline:2px solid var(--auth-accent);outline-offset:1px}button{font:inherit;border:0;border-radius:7px;padding:.65rem 1rem;background:var(--auth-accent);color:#fff;font-weight:700;cursor:pointer}button:hover{filter:brightness(.94)}button.secondary{background:#e8eef8;color:#173a76}button.danger{background:#9b2335}.hint{font-weight:400;color:var(--auth-muted);font-size:.9rem}.links{display:flex;gap:1rem;flex-wrap:wrap}a{color:var(--auth-accent)}#message:not(:empty){background:#eaf4ff;border:1px solid #a4c9ed;border-radius:7px;padding:.75rem;margin-bottom:1rem}#message.error{background:#fff0f0;border-color:#e5a6ab}.profile-list{list-style:none;padding:0;margin:0}.profile-item{border:1px solid var(--auth-border);border-radius:8px;padding:1rem;margin:.6rem 0}.profile-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:end}.profile-actions form{display:flex;gap:.4rem;margin:.5rem 0 0}.profile-actions input{max-width:180px}.badge{font-size:.75rem;color:#145237;background:#ddf4e7;border-radius:99px;padding:.2rem .5rem}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:500px){.auth-card{padding:1.25rem}.profile-actions form{width:100%}.profile-actions input{max-width:none}}
`;

export const clientJs = `// AI-generated code
/** Sends each built-in form as same-origin JSON and reports a safe response. */
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.api) return;
  event.preventDefault();
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
  const message = document.querySelector('#message');
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  if (message) { message.textContent = ''; message.classList.remove('error'); }
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const response = await fetch(form.dataset.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed.');
    if (form.dataset.next) window.location.assign(form.dataset.next);
    else if (message) message.textContent = result.message || 'Done.';
  } catch (error) {
    if (message) { message.textContent = error instanceof Error ? error.message : 'Request failed.'; message.classList.add('error'); }
  } finally {
    if (button) button.disabled = false;
  }
});
`;
