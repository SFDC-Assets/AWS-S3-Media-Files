#!/bin/bash
#
#  Deletes all scratch orgs.
#
#  Copyright (c) 2022, salesforce.com, inc.
#  All rights reserved.
#  SPDX-License-Identifier: BSD-3-Clause
#  For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
#
#  Contact: john.meyer@salesforce.com

readonly devHubOrgAlias=$(jq --raw-output .defaultdevhubusername < .sfdx/sfdx-config.json) || {
    echo "Make sure that \"jq\" is installed and that \"defaultdevhubusername\" is defined in .sfdx/sfdx-config.json." >&2
    exit 1
}
readonly tmpFile=$(jq --raw-output .defaultdevhubusername < .sfdx/sfdx-config.json) || {
    echo "Make sure that \"jq\" is installed and that \"defaultdevhubusername\" is defined in .sfdx/sfdx-config.json." >&2
    exit 1
}

sfdx force:data:soql:query \
    --query "SELECT Id FROM ScratchOrgInfo" \
    --resultformat csv \
    --targetusername "$devHubOrgAlias" > "$tmpFile"
echo "*** Deleting all scratch orgs ..."
sfdx force:data:bulk:delete --csvfile "$tmpFile" --sobjecttype ScratchOrgInfo --wait 10 --targetusername "$devHubOrgAlias" --loglevel error
rm -f "$tmpFile"