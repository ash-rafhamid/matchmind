#!/usr/bin/env bash
# Provision and deploy MatchMind on Azure with the Azure CLI + Docker.
#
#   Microsoft Foundry (AI Services) + gpt-4.1-mini (Global Standard)
#   Azure Container Registry (image built locally - ACR Tasks are not available on student subscriptions)
#   Azure Container Apps, WorkloadProfiles environment (Express environments do not support managed identity)
#   System-assigned managed identity: AcrPull for the image, "Cognitive Services OpenAI User" for the model -
#   no registry passwords and no model keys anywhere
#
# Usage:  LOCATION=japaneast bash infra/deploy.sh        (run from the repo root, Docker running, az logged in)
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: keep /subscriptions/... as-is

AZ=${AZ:-az}
LOCATION=${LOCATION:-japaneast}
RG=${RG:-rg-matchmind}
SUB=$($AZ account show --query id -o tsv)
SUFFIX=${SUFFIX:-$(echo -n "$SUB" | md5sum | cut -c1-6)}
FOUNDRY=${FOUNDRY:-matchmind-ai-$SUFFIX}
ACR=${ACR:-matchmindacr$SUFFIX}
MODEL=${MODEL:-gpt-4.1-mini}
MODEL_VERSION=${MODEL_VERSION:-2025-04-14}
CAPACITY=${CAPACITY:-200}   # thousand tokens per minute
APP=${APP:-matchmind}
ENVIRONMENT=${ENVIRONMENT:-matchmind-wp}
TAG=${TAG:-v$(date +%Y%m%d%H%M)}

echo "==> providers"
for ns in Microsoft.CognitiveServices Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  $AZ provider register --namespace "$ns" --wait >/dev/null
done

echo "==> resource group $RG ($LOCATION)"
$AZ group create -n "$RG" -l "$LOCATION" -o none

echo "==> Microsoft Foundry resource $FOUNDRY + $MODEL"
$AZ cognitiveservices account show -n "$FOUNDRY" -g "$RG" -o none 2>/dev/null || \
  $AZ cognitiveservices account create -n "$FOUNDRY" -g "$RG" -l "$LOCATION" \
    --kind AIServices --sku S0 --custom-domain "$FOUNDRY" --yes -o none
$AZ cognitiveservices account deployment create -n "$FOUNDRY" -g "$RG" --deployment-name "$MODEL" \
  --model-name "$MODEL" --model-version "$MODEL_VERSION" --model-format OpenAI \
  --sku-name GlobalStandard --sku-capacity "$CAPACITY" -o none
ENDPOINT=$($AZ cognitiveservices account show -n "$FOUNDRY" -g "$RG" --query properties.endpoint -o tsv)

echo "==> registry $ACR + image $TAG (local Docker build)"
$AZ acr show -n "$ACR" -o none 2>/dev/null || $AZ acr create -n "$ACR" -g "$RG" -l "$LOCATION" --sku Basic -o none
SERVER=$($AZ acr show -n "$ACR" --query loginServer -o tsv)
$AZ acr login -n "$ACR"
docker build -t "$SERVER/matchmind:$TAG" .
docker push "$SERVER/matchmind:$TAG"

echo "==> container app $APP"
ENV_VARS=(LLM_PROVIDER=azure_openai AZURE_OPENAI_ENDPOINT="$ENDPOINT" AZURE_OPENAI_DEPLOYMENT="$MODEL"
          AZURE_OPENAI_API_VERSION=2024-10-21 AI_REQUESTS_PER_10_MIN=40)
if $AZ containerapp show -n "$APP" -g "$RG" -o none 2>/dev/null; then
  $AZ containerapp update -n "$APP" -g "$RG" --image "$SERVER/matchmind:$TAG" --set-env-vars "${ENV_VARS[@]}" -o none
else
  $AZ containerapp env show -n "$ENVIRONMENT" -g "$RG" -o none 2>/dev/null || \
    $AZ containerapp env create -n "$ENVIRONMENT" -g "$RG" -l "$LOCATION" --environment-mode WorkloadProfiles -o none
  $AZ containerapp create -n "$APP" -g "$RG" --environment "$ENVIRONMENT" --image "$SERVER/matchmind:$TAG" \
    --registry-server "$SERVER" --registry-identity system --system-assigned \
    --ingress external --target-port 8000 --cpu 1.0 --memory 2.0Gi \
    --min-replicas 1 --max-replicas 2 --env-vars "${ENV_VARS[@]}" -o none
fi

echo "==> managed identity -> Foundry (keyless)"
PRINCIPAL=$($AZ containerapp show -n "$APP" -g "$RG" --query identity.principalId -o tsv)
SCOPE=$($AZ cognitiveservices account show -n "$FOUNDRY" -g "$RG" --query id -o tsv)
$AZ role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" --scope "$SCOPE" -o none 2>/dev/null || true

URL=$($AZ containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
echo
echo "MatchMind is live: https://$URL"
echo "MCP endpoint:      https://$URL/mcp/"
echo "Studio overlay:    https://$URL/#/studio/<match-id>"
echo "Foundry endpoint:  $ENDPOINT (deployment $MODEL)"
