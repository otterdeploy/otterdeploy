/**
 * Check if any changed file matches the configured watch path patterns.
 *
 * If watchPaths is null or empty, all changes are considered matching
 * (deploy on any change). If watchPaths is set, at least one changed
 * file must match at least one pattern for a match.
 *
 * Supports simple glob patterns:
 * - `*` matches any sequence of characters except `/`
 * - `**` matches any sequence of characters including `/`
 */
export function matchesWatchPaths(
  changedFiles: string[],
  watchPaths: string[] | null,
): boolean {
  // No watch paths configured = always match
  if (!watchPaths || watchPaths.length === 0) {
    return true;
  }

  for (const file of changedFiles) {
    for (const pattern of watchPaths) {
      if (globMatch(file, pattern)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Simple glob matching supporting `*` and `**` patterns.
 *
 * - `*` matches any sequence of non-`/` characters
 * - `**` matches any sequence of characters including `/`
 */
function globMatch(filePath: string, pattern: string): boolean {
  // Escape regex special characters except * and **
  let regexStr = "";
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      // ** matches everything including path separators
      regexStr += ".*";
      i += 2;
      // Skip optional trailing slash after **
      if (pattern[i] === "/") {
        i++;
      }
    } else if (pattern[i] === "*") {
      // * matches everything except path separators
      regexStr += "[^/]*";
      i++;
    } else if (
      ".+?^${}()|[]\\".includes(pattern[i])
    ) {
      // Escape regex special characters
      regexStr += `\\${pattern[i]}`;
      i++;
    } else {
      regexStr += pattern[i];
      i++;
    }
  }

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}
