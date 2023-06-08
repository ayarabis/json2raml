const vscode = require("vscode");
const { Range, Position } = require("vscode");

let ramlDocument = null;

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("json2raml.convert", processJsonToRaml)
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      {
        language: "json",
      },
      {
        provideCodeLenses(document, token) {
          try {
            JSON.parse(document.getText());
          } catch (error) {
            return [];
          }
          return [
            new vscode.CodeLens(document.lineAt(0).range, {
              title: "Convert to RAML",
              command: "json2raml.convert",
              arguments: [],
            }),
          ];
        },
      }
    )
  );
}

/**
 * @param {Object} json
 * @returns String
 */
function convertJsonToRaml(json) {
  let raml = "#%RAML 1.0 DataType\n\n";

  /**
   * @param {Object} obj
   * @param {String} indent
   */
  function processObject(obj, indent) {
    if (obj === null) {
      raml += `${indent}type: any\n`;
    } else if (Array.isArray(obj)) {
      raml += `${indent}type: array\n`;
      raml += `${indent}items:\n`;
      if (obj.length > 0) {
        processObject(obj[0], indent + "  ");
      } else {
        raml += `${indent}  type: any\n`;
      }
    } else if (typeof obj === "object") {
      raml += `${indent}type: object\n`;
      raml += `${indent}properties:\n`;
      indent += "  ";
      for (let key in obj) {
        let value = obj[key];
        if (value === null) {
          key += "?";
        }
        if (key.startsWith("@")) {
          raml += `${indent}"${key}":\n`;
        } else {
          raml += `${indent}${key}:\n`;
        }
        if (Array.isArray(value)) {
          processObject(value, indent + "  ");
        } else if (typeof value === "object") {
          processObject(value, indent + "  ");
        } else {
          let type = Number.isInteger(value) ? "integer" : typeof value;
          raml += `${indent}  type: ${type}\n`;
        }
      }
    } else {
      let type = Number.isInteger(obj) ? "integer" : typeof obj;
      raml += `${indent}type: ${type}\n`;
    }
  }

  processObject(json, "");

  const includeSourceAsExample = vscode.workspace
    .getConfiguration("json2raml")
    .get("includeSourceAsExample");
  if (includeSourceAsExample) {
    raml += "\n";
    raml += "example: " + JSON.stringify(json, null, 2);
  }

  return raml;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
async function processJsonToRaml(...args) {
  const editor = vscode.window.activeTextEditor;
  const document = editor.document;
  const text = document.getText();
  if (text.trim() === "") {
    return;
  }

  const json = JSON.parse(text);
  let raml = "";
  if (json.$schema) {
    raml = convertJsonSchemaToRaml(json);
  } else {
    raml = convertJsonToRaml(json);
  }

  let ramlEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document === ramlDocument
  );

  if (ramlDocument === null) {
    ramlDocument = await vscode.workspace.openTextDocument({
      language: "raml",
    });
  }
  ramlEditor = await vscode.window.showTextDocument(
    ramlDocument,
    vscode.ViewColumn.Beside
  );
  // replace the text in the new document with the raml text
  await ramlEditor.edit((editBuilder) => {
    editBuilder.replace(
      new Range(
        new Position(0, 0),
        new Position(ramlDocument.lineCount + 1, 0)
      ),
      raml
    );
  });
}

/**
 * @param {Object} json JSON Schema object
 * @returns String
 * @description Convert JSON Schema to RAML
 */
function convertJsonSchemaToRaml(json) {
  let raml = "#%RAML 1.0 DataType\n\n";

  var ruleAttributes = [
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
    "uniqueItems",
    "minItems",
    "maxItems",
  ];

  /**
   * @param {Object} obj JSON Schema object
   * @param {String} indent indentation
   * @description Extract JSON Schema rules and convert to RAML if applicable
   */
  function extractRules(obj, indent) {
    ruleAttributes.forEach((rule) => {
      if (obj.hasOwnProperty(rule)) {
        raml += `${indent}${rule}: ${obj[rule]}\n`;
      }
    });
    // if enum, convert to raml enum list
    if (obj.hasOwnProperty("enum")) {
      raml += `${indent}enum:\n`;
      obj.enum.forEach((item) => {
        raml += `${indent}  - ${item}\n`;
      });
    }
  }

  /**
   * @param {Object} obj JSON Schema object
   * @param {String} indent indentation
   * @param {Array} required list of required properties
   * @param {Object} parent parent object
   */
  function processObject(name, obj, indent, required, parent = null) {
    if (obj.type === "object") {
      raml += `${indent}type: object\n`;
      raml += `${indent}properties:\n`;
      indent += "  ";
      extractRules(obj, indent);
      for (let key in obj.properties) {
        let value = obj.properties[key];
        raml += `${indent}${key}:\n`;

        processObject(key, value, indent + "  ", obj.required, obj);
      }
    } else if (obj.type === "array") {
      raml += `${indent}type: array\n`;
      extractRules(obj, indent);
      raml += `${indent}items:\n`;
      processObject(null, obj.items, indent + "  ", obj.required, obj);
    } else {
      raml += `${indent}type: ${obj.type}\n`;
      extractRules(obj, indent);
    }
    // required is not allowed for array items
    if (parent?.type == "array") {
      return;
    }
    // if property is not required, add required: false since raml required is true by default
    if (!required?.includes(name)) {
      raml += `${indent}required: false\n`;
    }
  }

  processObject(null, json, "", json.required, json);

  return raml;
}
