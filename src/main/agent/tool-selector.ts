/**
 * NEX AI — Tool Selector
 *
 * Given an AgentStep that specifies a tool, this module:
 *  - Looks up the tool definition from the registry
 *  - Validates the parameters against the tool's schema
 *  - Returns a ready-to-execute ToolCallRequest
 *
 * It does NOT execute the tool. Agent Core calls executeToolWithPermission()
 * separately so the permission flow can intercept.
 */

import type { ToolDefinition } from '../ai/tool-registry';
import { getTool } from '../ai/tool-registry';
import type { AgentStep } from './types';

export interface ToolCallRequest {
  toolName: string;
  toolDefinition: ToolDefinition;
  params: Record<string, any>;
  validationErrors: string[];
}

/**
 * Prepare a tool call from an AgentStep.
 * Returns null if the step doesn't reference a tool.
 */
export function prepareToolCall(step: AgentStep): ToolCallRequest | null {
  if (!step.toolName) return null;
  const tool = getTool(step.toolName);
  if (!tool) {
    return {
      toolName: step.toolName,
      toolDefinition: {
        name: step.toolName,
        description: '(unknown tool)',
        category: 'plugin',
        permission: 'read',
        parameters: [],
      },
      params: step.toolParams || {},
      validationErrors: [`Unknown tool: "${step.toolName}"`],
    };
  }
  const validationErrors = validateParams(tool.definition, step.toolParams || {});
  return {
    toolName: step.toolName,
    toolDefinition: tool.definition,
    params: step.toolParams || {},
    validationErrors,
  };
}

/**
 * Validate params against the tool's parameter schema.
 * Returns a list of error messages (empty if valid).
 */
export function validateParams(def: ToolDefinition, params: Record<string, any>): string[] {
  const errors: string[] = [];
  // Check required params
  for (const param of def.parameters) {
    if (param.required && (params[param.name] === undefined || params[param.name] === null)) {
      errors.push(`Missing required parameter: "${param.name}"`);
    }
  }
  // Check types
  for (const param of def.parameters) {
    const value = params[param.name];
    if (value === undefined || value === null) continue;
    const expectedType = param.type;
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (expectedType !== actualType) {
      // Allow number-as-string and string-as-number for forgiving UI
      if (expectedType === 'string' && typeof value === 'number') {
        // OK
      } else if (expectedType === 'number' && typeof value === 'string' && !isNaN(parseFloat(value))) {
        // OK
      } else {
        errors.push(`Parameter "${param.name}" should be ${expectedType}, got ${actualType}`);
      }
    }
  }
  return errors;
}
