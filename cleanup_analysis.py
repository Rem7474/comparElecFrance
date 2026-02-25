#!/usr/bin/env python3
# Remove dead code from analysisEngine.js

import re

with open('src/analysisEngine.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Dead functions to remove:
# 1. compareAllOffers
# 2. buildOffersData

# Function to find and remove a function by its name
def remove_function(content, func_name):
    # Find the pattern: export function funcName...
    # Then find the closing brace at the same indentation level as export
    
    # Build a regex that matches from export to the closing brace
    # This is tricky - we need to count braces
    pattern = rf'export\s+function\s+{func_name}\s*\([^)]*\)\s*{{'
    
    match = re.search(pattern, content)
    if not match:
        print(f"Function {func_name} not found")
        return content
    
    start_pos = match.start()
    # Find the JSDoc comment before it
    before = content[:start_pos]
    jsdoc_start = before.rfind('/**')
    if jsdoc_start == -1:
        jsdoc_start = start_pos
    else:
        # Make sure this JSDoc is for our function (check if next line after /** has @param or description)
        jsdoc_section = before[jsdoc_start:]
        lines_after = content[jsdoc_start:start_pos].split('\n')
        if len(lines_after) > 1 and ('*' in lines_after[1] or '/*' in lines_after[1]):
            pass  # It's the JSDoc
        else:
            jsdoc_start = start_pos
    
    # Now find the closing brace
    brace_count = 0
    opening_brace_pos = match.end() - 1  # The { of the function
    pos = opening_brace_pos
    in_string = False
    string_char = None
    
    while pos < len(content):
        char = content[pos]
        
        # Handle strings
        if char in ['"', "'", '`'] and (pos == 0 or content[pos-1] != '\\'):
            if not in_string:
                in_string = True
                string_char = char
            elif char == string_char:
                in_string = False
        
        # Handle braces (outside strings)
        if not in_string:
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    # Found the closing brace
                    end_pos = pos + 1
                    removed_text = content[jsdoc_start:end_pos]
                    lines_removed = removed_text.count('\n')
                    print(f"Removing {func_name}: {lines_removed} lines (from char {jsdoc_start} to {end_pos})")
                    return content[:jsdoc_start] + '\n' + content[end_pos:]
        
        pos += 1
    
    print(f"Could not find closing brace for {func_name}")
    return content

# Remove the dead functions
content = remove_function(content, 'compareAllOffers')
content = remove_function(content, 'buildOffersData')

with open('src/analysisEngine.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done!")
