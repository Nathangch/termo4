import os

def update_words():
    with open('Cinco2.txt', 'r', encoding='utf-8') as f:
        words = []
        for line in f:
            w = line.strip().strip('"').strip(',').strip('"')
            if w:
                words.append(w)
    
    words_str = "const WORDS_DATA = [" + ", ".join(f"'{w}'" for w in words) + "];"
    
    with open('words.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    import re
    new_content = re.sub(r'const WORDS_DATA = \[.*?\];', words_str, content, flags=re.DOTALL)
    
    with open('words.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Updated words.js successfully")

if __name__ == "__main__":
    update_words()
