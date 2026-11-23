#!/usr/bin/env bash
# Registers Reviewer in the Entra ID tenant the az CLI is signed in to and writes deploy/.env.
#
#   deploy/azure/entra-app.sh <reviewer-host> [acme-email]
#
# It follows the README ("Entra ID app registration"): a single-tenant web app with the redirect
# URI https://<host>/oauth2/callback, the optional `email` claim, the app roles ADMIN and USER and
# a client secret (valid one year). On top of that it switches on "Assignment required", so only
# people with a role get in – tenant members and B2B guests alike – and gives you the ADMIN role.
# Add reviewers with deploy/azure/invite-guest.sh.
#
# Needs the right to register applications; inviting guests needs the Guest Inviter role.
set -euo pipefail

HOST=${1:?Usage: entra-app.sh <reviewer-host> [acme-email]}
ME_ID=$(az ad signed-in-user show --query id -o tsv)
ME_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
ACME_EMAIL=${2:-$(az ad signed-in-user show --query mail -o tsv)}
APP_NAME=${APP_NAME:-Reviewer}
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

[ -e "$ENV_FILE" ] && { echo "$ENV_FILE already exists – move it away first, it holds the current secrets." >&2; exit 1; }
[ -n "$ACME_EMAIL" ] || { echo "Your account has no mail address – pass the ACME contact e-mail as the second argument." >&2; exit 1; }

uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
ADMIN_ROLE_ID=$(uuid)
USER_ROLE_ID=$(uuid)
ROLES=$(cat <<JSON
[
  {"id": "$ADMIN_ROLE_ID", "displayName": "Admin", "description": "Manages projects, owners and comments", "value": "ADMIN", "allowedMemberTypes": ["User"], "isEnabled": true},
  {"id": "$USER_ROLE_ID", "displayName": "User", "description": "Reviews projects and comments", "value": "USER", "allowedMemberTypes": ["User"], "isEnabled": true}
]
JSON
)

APP_ID=$(az ad app create --display-name "$APP_NAME" --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "https://$HOST/oauth2/callback" \
  --app-roles "$ROLES" \
  --optional-claims '{"idToken": [{"name": "email", "essential": false}]}' \
  --query appId -o tsv)
SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
az ad sp update --id "$SP_ID" --set appRoleAssignmentRequired=true
CLIENT_SECRET=$(az ad app credential reset --id "$APP_ID" --display-name oauth2-proxy --years 1 --query password -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

az rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignedTo" \
  --body "{\"principalId\": \"$ME_ID\", \"resourceId\": \"$SP_ID\", \"appRoleId\": \"$ADMIN_ROLE_ID\"}" --output none

umask 077
cat > "$ENV_FILE" <<ENV
# Written by deploy/azure/entra-app.sh – app registration "$APP_NAME" ($APP_ID).
REVIEWER_HOST=$HOST
ACME_EMAIL=$ACME_EMAIL

ENTRA_TENANT_ID=$TENANT_ID
OAUTH2_PROXY_CLIENT_ID=$APP_ID
OAUTH2_PROXY_CLIENT_SECRET=$CLIENT_SECRET
OAUTH2_PROXY_COOKIE_SECRET=$(python3 -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')

# Access comes only from the app roles (Assignment required is on), so no bootstrap admin and no
# default role.
ADMIN_EMAILS=
DEFAULT_ROLE=
DEFAULT_LOCALE=${DEFAULT_LOCALE:-en}
REVIEWER_TAG=${REVIEWER_TAG:-latest}
ENV

echo "App registration $APP_NAME: $APP_ID (tenant $TENANT_ID), ADMIN role assigned to $ME_UPN."
echo "Wrote $ENV_FILE. The client secret expires in one year."
