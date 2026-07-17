// # Entry point: Handles CLI commands (init / run-hook)

// Import the markdown update function from the filesystem writer module
import { applyMarkdownUpdates } from './writer/filesystem';
// Import Node.js file system module for reading files synchronously
import { readFileSync } from 'fs';

/**
 * Orchestrates the markdown update process by reading a JSON file
 * and applying the updates to the specified repository.
 * 
 * @param jsonPath - Path to the JSON file containing markdown updates
 * @param outputRoot - Repository directory where files will be written
 * @throws When the JSON file cannot be read or contains invalid data
 */
export function runUpdate(jsonPath: string, outputRoot: string) {
  try {
    // Read the JSON file containing the markdown updates
    const json = readFileSync(jsonPath, 'utf8');
    
    // Apply the markdown updates to the repository and get the result
    const result = applyMarkdownUpdates(json, outputRoot);
    
    // Log the list of files that were successfully written
    console.log('Written files:', result.written);
  } catch (error) {
    // Handle file reading errors or markdown update errors
    console.error('Error applying markdown updates:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// This function would be called by CLI command handlers (e.g., when user runs a command like 'gitagent update')