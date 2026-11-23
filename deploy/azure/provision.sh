#!/usr/bin/env bash
# Creates the Azure VM that runs deploy/docker-compose.yaml: one resource group with an Ubuntu VM,
# a public IP with a DNS name, and a network security group (80/443 open, 22 from one address).
#
#   az login
#   DNS_LABEL=my-reviewer deploy/azure/provision.sh
#
# Re-running it is safe: existing resources are kept. Remove everything with
#   az group delete --name "$RESOURCE_GROUP"
#
# Settings (environment):
#   DNS_LABEL        required; the host becomes <label>.<location>.cloudapp.azure.com
#   SUBSCRIPTION     subscription name or id (default: the az CLI's current one)
#   RESOURCE_GROUP   default reviewer-rg
#   LOCATION         default westeurope
#   VM_NAME          default reviewer
#   VM_SIZE          default Standard_B2s (2 vCPU, 4 GB)
#   ADMIN_USER       default azureuser
#   SSH_SOURCE       address or CIDR allowed to reach port 22 (default: this machine's public IP)
set -euo pipefail

: "${DNS_LABEL:?Set DNS_LABEL – the host becomes <label>.<location>.cloudapp.azure.com}"
RESOURCE_GROUP=${RESOURCE_GROUP:-reviewer-rg}
LOCATION=${LOCATION:-westeurope}
VM_NAME=${VM_NAME:-reviewer}
VM_SIZE=${VM_SIZE:-Standard_B2s}
ADMIN_USER=${ADMIN_USER:-azureuser}
SSH_SOURCE=${SSH_SOURCE:-$(curl -fsS https://api.ipify.org)}
HERE=$(cd "$(dirname "$0")" && pwd)

[ -n "${SUBSCRIPTION:-}" ] && az account set --subscription "$SUBSCRIPTION"
echo "Subscription: $(az account show --query name -o tsv)"
echo "Creating $VM_NAME ($VM_SIZE) in $RESOURCE_GROUP / $LOCATION, SSH allowed from $SSH_SOURCE"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# No default rule: `az vm create` would otherwise open SSH to the whole internet.
NSG="$VM_NAME-nsg"
az network nsg create --resource-group "$RESOURCE_GROUP" --name "$NSG" --output none
az network nsg rule create --resource-group "$RESOURCE_GROUP" --nsg-name "$NSG" --name web \
  --priority 100 --access Allow --protocol Tcp --destination-port-ranges 80 443 --output none
az network nsg rule create --resource-group "$RESOURCE_GROUP" --nsg-name "$NSG" --name ssh \
  --priority 110 --access Allow --protocol Tcp --destination-port-ranges 22 \
  --source-address-prefixes "$SSH_SOURCE" --output none

CLOUD_INIT=$(mktemp)
trap 'rm -f "$CLOUD_INIT"' EXIT
sed "s/\${ADMIN_USER}/$ADMIN_USER/" "$HERE/cloud-init.yaml" > "$CLOUD_INIT"

az vm create \
  --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
  --image Ubuntu2404 --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" --generate-ssh-keys \
  --public-ip-sku Standard --public-ip-address-dns-name "$DNS_LABEL" \
  --nsg "$NSG" --custom-data "$CLOUD_INIT" \
  --output none

HOST=$(az vm show --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --show-details --query fqdns -o tsv)
cat <<DONE

VM is up. Docker finishes installing a minute or two after the first boot.

  REVIEWER_HOST=$HOST
  SSH_TARGET=$ADMIN_USER@$HOST

Next:
  deploy/azure/entra-app.sh $HOST          # app registration + deploy/.env
  SSH_TARGET=$ADMIN_USER@$HOST deploy/deploy.sh
DONE
