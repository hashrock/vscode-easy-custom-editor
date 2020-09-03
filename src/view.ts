import * as vscode from 'vscode';
export function getViewHtml(cspSource: string, nonce: string, scriptUri: vscode.Uri): string {
	return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} blob:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
			</head>
			<body>
				<div id="app"></div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
}
