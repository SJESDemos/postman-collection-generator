// SPDX-License-Identifier: Apache-2.0

import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from 'oidc-client-ts';

interface AuthenticationConfiguration {
  authority: string;
  client_id: string;
  hosted_ui_domain: string;
  redirect_uri: string;
  post_logout_redirect_uri: string;
}

interface RuntimeConfiguration {
  authentication: AuthenticationConfiguration | null;
}

export interface AuthenticationState {
  enabled: boolean;
  user: User | null;
}

let manager: UserManager | undefined;
let currentUser: User | null = null;
let configuration: AuthenticationConfiguration | null = null;

async function loadConfiguration(): Promise<RuntimeConfiguration> {
  if (window.location.protocol === 'file:') return { authentication: null };
  const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Unable to load the application authentication configuration.');
  return response.json() as Promise<RuntimeConfiguration>;
}

function managerSettings(auth: AuthenticationConfiguration): UserManagerSettings {
  return {
    authority: auth.authority,
    client_id: auth.client_id,
    redirect_uri: auth.redirect_uri,
    post_logout_redirect_uri: auth.post_logout_redirect_uri,
    response_type: 'code',
    scope: 'openid email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    metadata: {
      issuer: auth.authority,
      authorization_endpoint: `${auth.hosted_ui_domain}/oauth2/authorize`,
      token_endpoint: `${auth.hosted_ui_domain}/oauth2/token`,
      userinfo_endpoint: `${auth.hosted_ui_domain}/oauth2/userInfo`,
      end_session_endpoint: `${auth.hosted_ui_domain}/logout`,
      jwks_uri: `${auth.authority}/.well-known/jwks.json`,
    },
  };
}

function hasAuthorizationResponse(): boolean {
  const parameters = new URLSearchParams(window.location.search);
  return parameters.has('code') && parameters.has('state');
}

export async function initializeAuthentication(): Promise<AuthenticationState> {
  const runtime = await loadConfiguration();
  configuration = runtime.authentication;
  if (!configuration) return { enabled: false, user: null };

  manager = new UserManager(managerSettings(configuration));
  if (hasAuthorizationResponse()) {
    currentUser = await manager.signinRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
  } else {
    currentUser = await manager.getUser();
  }
  if (currentUser?.expired) {
    currentUser = await manager.signinSilent().catch(() => null);
  }
  return { enabled: true, user: currentUser };
}

export function accessToken(): string | undefined {
  return currentUser && !currentUser.expired ? currentUser.access_token : undefined;
}

export async function signIn(): Promise<void> {
  if (!manager) throw new Error('Authentication is not configured.');
  await manager.signinRedirect();
}

export async function signOut(): Promise<void> {
  if (!manager || !configuration) return;
  await manager.removeUser();
  currentUser = null;
  const logout = new URL('/logout', configuration.hosted_ui_domain);
  logout.searchParams.set('client_id', configuration.client_id);
  logout.searchParams.set('logout_uri', configuration.post_logout_redirect_uri);
  window.location.assign(logout);
}
