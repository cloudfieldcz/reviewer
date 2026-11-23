#!/usr/bin/env bash
# Gives someone access to Reviewer: assigns an app role, inviting the address as a B2B guest first
# when the tenant does not know it yet. A guest signs in with their own organisation's account;
# nothing has to be registered or approved in that organisation's tenant.
#
#   deploy/azure/invite-guest.sh <email> [USER|ADMIN]
#
# Reads REVIEWER_HOST and OAUTH2_PROXY_CLIENT_ID from deploy/.env. Needs the Guest Inviter role
# (or higher) for new guests. Re-running it for someone who already has the role is refused by
# Entra with "Permission being assigned already exists" – harmless.
set -euo pipefail

EMAIL=${1:?Usage: invite-guest.sh <email> [USER|ADMIN]}
ROLE=${2:-USER}
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
HOST=$(val REVIEWER_HOST)
APP_ID=$(val OAUTH2_PROXY_CLIENT_ID)
GRAPH=https://graph.microsoft.com/v1.0

SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
ROLE_ID=$(az ad sp show --id "$APP_ID" --query "appRoles[?value=='$ROLE'].id | [0]" -o tsv)
[ -n "$ROLE_ID" ] || { echo "The app has no role $ROLE" >&2; exit 1; }

# Members are found by their mail or UPN, guests by the mail they were invited with.
USER_ID=$(az rest --method GET --url "$GRAPH/users?\$filter=mail eq '$EMAIL' or userPrincipalName eq '$EMAIL'&\$select=id" \
  --query 'value[0].id' -o tsv)
if [ -z "$USER_ID" ]; then
  USER_ID=$(az rest --method POST --url "$GRAPH/invitations" \
    --body "{\"invitedUserEmailAddress\": \"$EMAIL\", \"inviteRedirectUrl\": \"https://$HOST/\", \"sendInvitationMessage\": true}" \
    --query invitedUser.id -o tsv)
  echo "Invited $EMAIL as a guest – the invitation e-mail links to https://$HOST/"
fi

az rest --method POST --url "$GRAPH/servicePrincipals/$SP_ID/appRoleAssignedTo" \
  --body "{\"principalId\": \"$USER_ID\", \"resourceId\": \"$SP_ID\", \"appRoleId\": \"$ROLE_ID\"}" --output none
echo "$EMAIL has the $ROLE role."
