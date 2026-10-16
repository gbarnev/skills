# Building and operating these workflows with the official n8n MCP

Read this before rendering/creating a workflow, and when debugging a failed execution.

## Tools and what they're for

| Step | Tool | Notes |
|---|---|---|
| Find IDs | `list_credentials`, `search_folders` (project id from a credential's `homeProject`), `search_workflows` | Credential *names* are stable; always look the IDs up. |
| Sheet tabs | `explore_node_resources` googleSheets 4.7 `sheetsSearch` (listSearch) with `currentNodeParameters.documentId = {__rl, mode:'id', value}` | Returns each tab's `name` and list `value`: `"gid=0"` for the first tab, the numeric gid for others. Use those as `TAB*_LIST_VALUE`. |
| Sheet columns | googleSheets 4.7 `getSheetHeaderRowWithGeneratedColumnNames` (loadOptions) with `resource`, `operation:'read'`, `documentId`, `sheetName` | Confirms `Email`, `Deal Stage`, `Meeting Date & ET Time` exist. |
| Spreadsheet search | googleSheets 4.7 `spreadSheetsSearch` with a `filter` | Find "<Client> Leads Dashboard" when the user gives no URL. |
| Slack channel id | slack 2.5 `getChannels` (listSearch) + `filter` | Only channels the bot is in; if missing, the user must `/invite` the bot. |
| State table | `create_data_table`, `add_data_table_rows` (≤1000 rows/call), `get_data_table_rows` | |
| Build | `get_workflow_sdk_reference` (once), `get_node_types` if changing nodes, `validate_workflow`, `create_workflow_from_code` (`projectId` + `folderId`) | |
| Fix-ups | `update_workflow` ops: `setNodeCredential`, `setWorkflowSettings`, `updateNodeParameters` | |
| Verify | `get_workflow_details` (connections + credentials), `execute_workflow` (manual), `get_workflow_execution` (`includeData`, `nodeNames`), `search_workflow_executions` | |
| Lifecycle | `publish_workflow`, `unpublish_workflow`, `archive_workflow`, `move_workflows_to_folder` | Archive is reversible from the n8n UI. |

The MCP **cannot create credentials**. Ask the user to add a **Bearer Auth** credential with the
token (name it e.g. "<Client> Calendly Bearer API Token" / "HubSpot <Client>") and tell you the name.

## SDK code rules that bit us

- The validator rejects runtime JS in workflow code: `[...].join()`, spread `...x`, etc. ("Method 'join'
  is not an allowed SDK method"). Keep Code-node source in `assets/code/*.js` and inline it with
  `scripts/render-workflow.mjs` — the rendered `jsCode` is one string literal.
- Expressions: `expr('…')` with single/double quotes, never backticks. Inside a single-quoted `expr`,
  a newline in the *resulting expression string* is written `\\n`.
- Every node needs an `output` sample; warnings like `INVALID_EXPRESSION_PATH … no predecessor outputs
  this field` come from those samples and are harmless.
- `TOP_LEVEL_ITEMS_OVER_CEILING` (grouping) is cosmetic. `PLAIN_GENERIC_AUTH` on HTTP nodes is fine when
  you attach an existing Bearer credential.
- `create_workflow_from_code` skips HTTP Request nodes during credential auto-assignment — always run
  `setNodeCredential` for every credentialed node afterwards (`credentialKey` = `httpBearerAuth`,
  `googleSheetsOAuth2Api`, `slackApi`).
- `setWorkflowSettings`: `errorWorkflow` (copy from an existing meeting workflow),
  `callerPolicy: workflowsFromSameOwner`, `executionOrder: v1`. Moving to a folder:
  `move_workflows_to_folder` (or `folderId` at creation).

## Node behaviours the templates depend on

- **Execution order v1** runs fan-out branches top to bottom by canvas position: the sheet-update
  branch (y = −200) runs before the Slack branch. State is saved only after Slack succeeds, so a failed
  post is retried on the next poll (the sheet update is idempotent).
- `alwaysOutputData: true` on the state-table read and the sheet reads: an empty table/tab would
  otherwise stop the run. The Code nodes ignore the resulting empty item.
- `executeOnce: true` on reads that sit after a multi-item node (otherwise they run once per item).
- Google Sheets **update**: match on `row_number`; for multi-tab clients the tab comes from the item
  (`sheetName` mode `name`, `={{ $json.sheetName }}`).
- Slack `blocksUi` must evaluate to an object: `={{ { "text": …, "blocks": [ … ] } }}` (a bare array or
  a string-built JSON posts plain text or breaks on quotes in names).
- Webhook raw body: Webhook `options.rawBody: true`; any Set node before the Code node needs
  `options: { includeBinary: true, stripBinary: false }`; read with `this.helpers.getBinaryDataBuffer`.
  `require('crypto')` is allowed in Code nodes on this instance.
- Calendly webhook URLs: production `https://<host>/webhook/<path>` (active workflow);
  `webhook-test/<path>` only while listening in the editor.

## Testing ladder

1. `node scripts/test-code-nodes.mjs [config.json]` — logic for every status transition (needs luxon).
2. `validate_workflow` on the rendered code.
3. After create + credentials: a run with no side effects (seeded polling run, or the signed
   non-matching webhook request) and read the execution data.
4. Only with the user's OK: a live run that posts to the client's Slack / edits the client's sheet
   (e.g. leave the most recent real booking out of the seed so the first run processes it).
5. After publishing: `search_workflow_executions` a few runs later; all `success`.

## Reading failures

Error alerts come from the shared error workflow with the execution id. Open it with
`get_workflow_execution(includeData: true, nodeNames: [<failed node>])` and read `httpCode` and
`messages`. n8n's wording for HTTP status codes: 500 "The service was not able to process your
request", 401 "Authorization failed - please check your credentials", 403 "Forbidden", 429 "The service
is receiving too many requests from you", 503 "Service unavailable". An error like
`Cannot read properties of null (reading '<trigger name>')` on a *manual* run is an n8n editor
partial-execution glitch, not a workflow problem.

If the n8n MCP points at a different instance (workflows you don't recognise, "Workflow not found"),
ask the user to reconnect the right n8n connector rather than guessing.
