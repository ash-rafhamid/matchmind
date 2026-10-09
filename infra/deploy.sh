#!/usr/bin/env bash
# Provision MatchMind on Azure with the Azure CLI:
#   Microsoft Foundry (AI Services) + a gpt-4.1-mini deployment
#   Azure Container Apps (cloud build from source, external HTTPS ingress)
#   Managed identity with "Cognitive Services OpenAI User" - no API keys anywhere
#
# Usage: LOCATION=eastus2 bash infra/deploy.sh
set -euo pipefail

AZ=${AZ:-az}
LOCATION=${LOCATION:-eastus2}
RG=${RG:-rg-matchmind}
SUFFIX=${SUFFIX:-$(echo -n "$($AZ account show --query id -o tsv)" | md5sum | cut -c1-6)}
FOUNDRY=${FOUNDRY:-matchmind-ai-$SUFFIX}
MODEL=${MODEL:-gpt-4.1-mini}
MODEL_VERSION=${MODEL_VERSION:-2025-04-14}
CAPACITY=${CAPACITY:-50}   # thousand tokens per minute
APP=${APP:-matchmind}
ENVIRONMENT=${ENVIRONMENT:-matchmind-env}

echo "==> providers"
for ns in Microsoft.CognitiveServices Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  $AZ provider register --namespace "$ns" --wait >/dev/null
done

echo "==> resource group $RG ($LOCATION)"
$AZ group create -n "$RG" -l "$LOCATION" -o none

echo "==> Microsoft Foundry resource $FOUNDRY"
if ! $AZ cognitiveservices account show -n "$FOUNDRY" -g "$RG" -o none 2>/dev/null; then
  $AZ cognitiveservices account create -n "$FOUNDRY" -g "$RG" -l "$LOCATION" \
    --kind AIServices --sku S0 --custom-domain "$FOUNDRY" --yes -o none
fi
ENDPOINT=$($AZ cognitiveservices account show -n "$FOUNDRY" -g "$RG" --query properties.endpoint -o tsv)

echo "==> model deployment $MODEL"
if ! $AZ cognitiveservices account deployment show -n "$FOUNDRY" -g "$RG" --deployment-name "$MODEL" -o none 2>/dev/null; then
  $AZ cognitiveservices account deployment create -n "$FOUNDRY" -g "$RG" --deployment-name "$MODEL" \
    --model-name "$MODEL" --model-version "$MODEL_VERSION" --model-format OpenAI \
    --sku-name GlobalStandard --sku-capacity "$CAPACITY" -o none
fi

echo "==> container app $APP (built in the cloud from the Dockerfile)"
$AZ containerapp up -n "$APP" -g "$RG" -l "$LOCATION" --environment "$ENVIRONMENT" \
  --source . --ingress external --target-port 8000 \
  --env-vars AZURE_OPENAI_ENDPOINT="$ENDPOINT" AZURE_OPENAI_DEPLOYMENT="$MODEL" LLM_PROVIDER=azure_openai \
             MATCHMIND_MCP_URL=http://localhost:8000/mcp/ AI_REQUESTS_PER_10_MIN=40

echo "==> managed identity -> Foundry (keyless)"
PRINCIPAL=$($AZ containerapp identity assign -n "$APP" -g "$RG" --system-assigned --query principalId -o tsv)
SCOPE=$($AZ cognitiveservices account show -n "$FOUNDRY" -g "$RG" --query id -o tsv)
$AZ role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" --scope "$SCOPE" -o none || true
$AZ containerapp update -n "$APP" -g "$RG" --min-replicas 1 --max-replicas 2 -o none

URL=$($AZ containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
echo
echo "MatchMind is live: https://$URL"
echo "Foundry endpoint:  $ENDPOINT (deployment $MODEL)"
