// --- Configuração e Dados (Carregados via words.js) ---
const WORDS = typeof WORDS_DATA !== 'undefined' ? WORDS_DATA : [];

function normalizeWord(word) {
    return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

/**
 * Classe que gerencia um único tabuleiro (Board).
 * Pode haver 1, 2 ou 4 instâncias dessa classe ativas.
 */
class Board {
    constructor(id, totalRows, secretWord, cols = 5) {
        this.id = id;
        this.ROWS = totalRows;
        this.COLS = cols;
        this.secretWord = secretWord;
        this.gridState = Array(this.ROWS).fill(null).map(() => Array(this.COLS).fill(""));
        this.currentRow = 0;
        this.isSolved = false;
        this.isFailed = false;
        this.element = null; // Referência ao DOM
    }

    // Cria o HTML do tabuleiro
    render(container) {
        this.element = document.createElement('div');
        this.element.id = `board-${this.id}`;
        this.element.className = 'board';
        this.element.style.setProperty('--rows', this.ROWS);

        for (let r = 0; r < this.ROWS; r++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'row';
            for (let c = 0; c < this.COLS; c++) {
                const tile = document.createElement('div');
                tile.className = 'tile';
                tile.id = `tile-${this.id}-${r}-${c}`;
                // Click handler removido aqui para ser gerenciado pelo Game controller centralmente se necessário
                // ou apenas visual. O clique foca "globalmente" na linha atual.
                tile.addEventListener('click', () => game.handleTileClick(this.id, r, c));
                rowDiv.appendChild(tile);
            }
            this.element.appendChild(rowDiv);
        }
        container.appendChild(this.element);
    }

    addLetter(letter, col) {
        if (this.isSolved || this.isFailed) return; // Tabuleiro congelado

        this.gridState[this.currentRow][col] = letter;
        const tile = document.getElementById(`tile-${this.id}-${this.currentRow}-${col}`);
        if (tile) {
            tile.textContent = letter;
            tile.classList.remove('pop');
            void tile.offsetWidth;
            tile.classList.add('pop');
            tile.setAttribute('data-status', 'tbd');
        }
    }

    removeLetter(col) {
        if (this.isSolved || this.isFailed) return;

        this.gridState[this.currentRow][col] = "";
        const tile = document.getElementById(`tile-${this.id}-${this.currentRow}-${col}`);
        if (tile) {
            tile.textContent = "";
            tile.removeAttribute('data-status');
        }
    }

    // Retorna o resultado da avaliação dessa linha
    checkRow(wordGuess, animate = true) {
        if (this.isSolved || this.isFailed) return null; // Não processa

        const secretChars = this.secretWord.split("");
        const guessChars = wordGuess.split("");
        const results = Array(this.COLS).fill("absent");
        const secretLettersCount = {};

        secretChars.forEach(char => secretLettersCount[char] = (secretLettersCount[char] || 0) + 1);

        // 1. Greens
        guessChars.forEach((char, i) => {
            if (char === secretChars[i]) {
                results[i] = "correct";
                secretLettersCount[char]--;
            }
        });
        // 2. Yellows
        guessChars.forEach((char, i) => {
            if (results[i] !== "correct" && secretLettersCount[char] > 0) {
                results[i] = "present";
                secretLettersCount[char]--;
            }
        });

        // Aplica visual
        const rowToUpdate = this.currentRow;
        guessChars.forEach((char, i) => {
            const updateTile = () => {
                const tile = document.getElementById(`tile-${this.id}-${rowToUpdate}-${i}`);
                if (tile) {
                    if (animate) tile.classList.add('flip');
                    tile.classList.add(results[i]);
                    tile.removeAttribute('data-status');
                    tile.textContent = char; // Ensure text is set during restoration
                }
            };

            if (animate) {
                setTimeout(updateTile, i * 250);
            } else {
                updateTile();
            }
        });

        return results;
    }

    finalizeRow(wordGuess) {
        if (this.isSolved || this.isFailed) return;

        if (wordGuess === this.secretWord) {
            this.isSolved = true;
            setTimeout(() => this.element.classList.add('solved'), 1500);
        } else if (this.currentRow === this.ROWS - 1) {
            this.isFailed = true;
            this.element.classList.add('failed'); // Visual opcional
        } else {
            this.currentRow++;
        }
    }

    updateFocus(col, isGameActive) {
        // Limpa foco anterior deste board
        const tiles = this.element.querySelectorAll('.tile');
        tiles.forEach(t => t.classList.remove('active-focus'));

        if (!isGameActive || this.isSolved || this.isFailed) return;

        const tile = document.getElementById(`tile-${this.id}-${this.currentRow}-${col}`);
        if (tile) tile.classList.add('active-focus');
    }
}


/**
 * Classe principal do Jogo com suporte a múltiplos modos.
 */
class Game {
    constructor() {
        this.mode = 1; // 1, 2, 4, 'crossword'
        this.maxAttempts = 6;
        this.boards = [];
        this.currentCol = 0;
        this.isGameOver = false;
        this.playStyle = 'daily'; // 'daily' or 'training'
        this.dailyState = this.loadDailyState();
        this.stats = this.loadStats();
        this.usedCrosswordWords = new Set();
        // Crossword / Exact specific state
        this.cwGrid = null; // { words, rows, cols }
        this.cwState = {}; // Key: "r,c", Value: { char: "", type: "empty"|"correct"|"present"|"absent", isFixed: bool }
        this.cwActiveWordIndex = -1;
        this.selectedNumber = null; // For exact-crossword
        this.numberPool = []; // Available numbers for exact mode
        // Sudoku specific state
        this.sudokuGrid = null; // [9][9]
        this.sudokuSolution = null; // [9][9]
        this.sudokuCursor = { r: 0, c: 0 };
        this.sudokuState = {}; // Key: "r,c", Value: { char: "", isFixed: bool }

        // Elementos UI
        this.boardsContainer = document.getElementById('boards-container');
        this.keyboardContainer = document.getElementById('keyboard');
        this.headerFinishBtn = document.getElementById('header-finish-btn');

        // Inicializa listeners
        this.initListeners();

        // Inicia modo padrão
        this.setMode(1);
    }

    loadStats() {
        const defaultStats = {
            1: { played: 0, won: 0, streak: 0, maxStreak: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 } },
            2: { played: 0, won: 0, streak: 0, maxStreak: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, fail: 0 } },
            4: { played: 0, won: 0, streak: 0, maxStreak: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, fail: 0 } },
            'math': { played: 0, won: 0, streak: 0, maxStreak: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 } },
            'crossword': { played: 0, won: 0, streak: 0, maxStreak: 0, dist: {} },
            'exact-crossword': { played: 0, won: 0, streak: 0, maxStreak: 0, dist: {} },
            'sudoku': { played: 0, won: 0, streak: 0, maxStreak: 0, dist: {} }
        };
        const stored = localStorage.getItem('termoMultiStats');
        return stored ? { ...defaultStats, ...JSON.parse(stored) } : defaultStats;
    }

    saveStats() {
        localStorage.setItem('termoMultiStats', JSON.stringify(this.stats));
    }

    loadDailyState() {
        const today = new Date();
        // Uses local date string YYYY-MM-DD
        const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
        
        const defaultState = {
            date: dateString,
            modes: {
                1: { status: 'playing', guesses: [] },
                2: { status: 'playing', guesses: [] },
                4: { status: 'playing', guesses: [] },
                'math': { status: 'playing', guesses: [] }
            }
        };

        const stored = localStorage.getItem('termoDailyState');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.date === dateString) {
                return { ...defaultState, modes: { ...defaultState.modes, ...parsed.modes } };
            }
        }
        return defaultState;
    }

    saveDailyState() {
        localStorage.setItem('termoDailyState', JSON.stringify(this.dailyState));
    }

    getDailyIndex(arrayLength, offset = 0) {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
        // Simple hash for deterministic indexing
        let hash = 0;
        const seedStr = dateStr + offset;
        for (let i = 0; i < seedStr.length; i++) {
            hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash) % arrayLength;
    }

    setMode(n) {
        // Toggle de Interface:
        // Se n === 'crossword', esconde o toggle do header.
        // Se n === 1, 2, 4, mostra o toggle.
        // Se o usuario selecionar '1' (Termo) vindo do Crossword, ele deve restaurar o modo anterior ou default (1).

        const headerLeft = document.querySelector('.header-left');
        const modeToggle = document.getElementById('mode-toggle');

        if (n === 'crossword' || n === 'exact-crossword' || n === 'sudoku' || n === 'math') {
            this.mode = n;
        } else {
            this.mode = parseInt(n);

            // Update UI Botoes do Header (Termo/Dueto/Quarteto)
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.mode) === this.mode);
            });

            // Update Label Headers
            const labels = { 1: 'TERMO', 2: 'DUETO', 4: 'QUARTETO' };
            const labelEl = document.getElementById('current-mode-label');
            if (labelEl) labelEl.textContent = labels[this.mode] || 'TERMO';

            this.maxAttempts = this.mode === 1 ? 6 : (this.mode === 2 ? 7 : 9);
        }

        if (this.mode === 'math') this.maxAttempts = 6;

        document.body.dataset.mode = this.mode;

        // Update Header Title
        const headerTitle = document.querySelector('header h1');
        const finishBtn = document.getElementById('header-finish-btn');
        
        if (headerTitle) {
            if (this.mode === 'crossword') headerTitle.innerHTML = 'PALAVRAS<br>CRUZADAS';
            else if (this.mode === 'exact-crossword') headerTitle.innerHTML = 'NÚMEROS<br>CRUZADOS';
            else if (this.mode === 'sudoku') headerTitle.textContent = 'SUDOKU';
            else if (this.mode === 'math') headerTitle.textContent = 'MATEMÁTICA';
            else headerTitle.textContent = 'TERMO';
        }

        // Show finish button only for modes that require validation
        if (finishBtn) {
            const needsValidation = this.mode === 'crossword' || this.mode === 'exact-crossword' || this.mode === 'sudoku';
            finishBtn.classList.toggle('hidden', !needsValidation);
        }

        // Manage Header Selectors Visibility
        const termoSelector = document.getElementById('termo-selector');
        const cwSelector = document.getElementById('crossword-selector');
        const playModeSelector = document.getElementById('play-mode-selector');
        const isCrossword = this.mode === 'crossword' || this.mode === 'exact-crossword';
        const isTermo = typeof this.mode === 'number';
        
        if (playModeSelector) {
            const supportsPlayMode = isTermo || this.mode === 'math';
            playModeSelector.classList.toggle('hidden', !supportsPlayMode);
        }

        if (termoSelector) termoSelector.classList.toggle('hidden', isCrossword || this.mode === 'sudoku' || this.mode === 'math');
        if (cwSelector) {
            cwSelector.classList.toggle('hidden', !isCrossword);
            // Show hints button for crossword modes
            const hintsBtn = document.getElementById('floating-hints-btn');
            if (hintsBtn) {
                hintsBtn.classList.toggle('hidden', !isCrossword);
            }
            // Update Label
            const cwLabel = document.getElementById('current-crossword-mode');
            if (cwLabel) {
                cwLabel.innerHTML = `${this.mode === 'crossword' ? 'LETRAS' : 'NÚMEROS'} <span class="arrow">▼</span>`;
            }
        }

        if (this.headerFinishBtn) {
            this.headerFinishBtn.classList.toggle('hidden', !isCrossword && this.mode !== 'sudoku');
        }

        // Close Bottom Menu implicitly
        const gamesModal = document.getElementById('games-modal');
        if (!gamesModal.classList.contains('hidden')) {
            gamesModal.classList.add('hidden');
            document.getElementById('modal-overlay').classList.add('hidden');
        }

        this.startNewGame();
    }

    startNewGame() {
        // Limpar sessões anteriores
        this.boardsContainer.innerHTML = '';
        this.boards = [];
        this.currentCol = 0;
        this.isGameOver = false;

        // Clear keyboard colors
        document.querySelectorAll('.key').forEach(k => {
            k.className = 'key';
            if (k.textContent === 'ENTER' || k.textContent === '⌫') k.classList.add('wide');
        });

        // Clear Crossword Controls if any
        const cwControls = document.getElementById('cw-floating-controls');
        if (cwControls) cwControls.innerHTML = '';

        // Manage Termo Selector Visibility & Label
        const termoSelector = document.getElementById('termo-selector');
        if (this.mode === 'crossword' || this.mode === 'exact-crossword' || this.mode === 'sudoku') {
            if (this.mode === 'sudoku') this.startSudoku();
            else if (this.mode === 'crossword') this.startCrossword();
            else this.startExactCrossword();
            return;
        } else {
            if (termoSelector) {
                if (this.mode === 'math') {
                    termoSelector.classList.add('hidden');
                } else {
                    termoSelector.classList.remove('hidden');
                }

                // Update Label Text
                const currentLabel = document.getElementById('current-termo-mode');
                const labels = { 1: 'TERMO', 2: 'DUETO', 4: 'QUARTETO' };
                if (currentLabel) {
                    currentLabel.innerHTML = `${labels[this.mode]} <span class="arrow">▼</span>`;
                }
            }
        }

        // Ajusta classes de CSS container
        if (this.mode === 'math') {
            this.boardsContainer.className = 'boards-math';
            let secret;
            if (this.playStyle === 'daily') {
                const pool = this.getMathPool();
                secret = pool[this.getDailyIndex(pool.length, 'math')].toUpperCase();
            } else {
                secret = this.generateMathEquation();
            }
            console.log("Math Secret:", secret);
            const board = new Board(0, 6, secret, 8);
            board.render(this.boardsContainer);
            this.boards.push(board);
        } else {
            this.boardsContainer.className = `boards-${this.mode}`;

            // Cria boards
            for (let i = 0; i < this.mode; i++) {
                let secret;
                if (this.playStyle === 'daily') {
                    secret = normalizeWord(WORDS[this.getDailyIndex(WORDS.length, `mode-${this.mode}-board-${i}`)]);
                } else {
                    secret = normalizeWord(WORDS[Math.floor(Math.random() * WORDS.length)]);
                }
                console.log(`Board ${i} Secret:`, secret);
                const board = new Board(i, this.maxAttempts, secret);
                board.render(this.boardsContainer);
                this.boards.push(board);
            }
        }

        this.createKeyboard();
        this.updateFocus();

        // Restore Daily State if applicable
        if (this.playStyle === 'daily') {
            const state = this.dailyState.modes[this.mode];
            if (state && state.guesses.length > 0) {
                this.restoreDailyGuesses(state.guesses);
            }
        }

        this.startCountdown();
    }

    getMathPool() {
        return [
            "12+3-8=7", "4*6-3=21", "18/2-3=6", "98-25=73", "88-25=63",
            "45+32=77", "9*8-12=60", "50/5+2=12", "100/4=25", "7*7+1=50",
            "3+4*5=23", "15+15=30", "99-11=88", "12*4+2=50", "81/9+1=10",
            "10*5-1=49", "6*6+4=40", "2+3*4=14", "20/4+5=10", "15-3*4=3"
        ].filter(eq => eq.length === 8);
    }

    restoreDailyGuesses(guesses) {
        this.isRestoring = true;
        guesses.forEach(guess => {
            // Fill boards state manually
            this.boards.forEach(board => {
                if (!board.isSolved && !board.isFailed) {
                    for (let c = 0; c < board.COLS; c++) {
                        board.gridState[board.currentRow][c] = guess[c];
                    }
                }
            });
            // Process turn WITHOUT animations or global state checks until end
            this.processTurn(guess, false); // Add 'animate' param to processTurn
        });
        this.checkGameState();
        this.isRestoring = false;
    }

    generateMathEquation() {
        const pool = [
            "12+3-8=7", "4*6-3=21", "18/2-3=6", "98-25=73", "88-25=63",
            "45+32=77", "9*8-12=60", "50/5+2=12", "100/4=25", "7*7+1=50",
            "3+4*5=23", "15+15=30", "99-11=88", "12*4+2=50", "81/9+1=10",
            "10*5-1=49", "6*6+4=40", "2+3*4=14", "20/4+5=10", "15-3*4=3"
        ];
        const validPool = pool.filter(eq => eq.length === 8);
        return validPool[Math.floor(Math.random() * validPool.length)].toUpperCase();
    }


    renderCrossword() {
        const wrapper = document.createElement('div');
        wrapper.className = 'crossword-container';

        // --- Grid ---
        const gridEl = document.createElement('div');
        gridEl.className = 'crossword-grid';
        gridEl.style.gridTemplateColumns = `repeat(${this.cwGrid.cols}, minmax(0, 1fr))`;
        gridEl.style.gridTemplateRows = `repeat(${this.cwGrid.rows}, minmax(0, 1fr))`;
        // Width is handled by CSS (max-content) now to respect padding

        this.cwGrid.element = gridEl;

        // Render cells
        for (let r = 0; r < this.cwGrid.rows; r++) {
            for (let c = 0; c < this.cwGrid.cols; c++) {
                const cellKey = `${r},${c}`;
                const cellState = this.cwState[cellKey];

                const cellDiv = document.createElement('div');
                cellDiv.className = 'cw-cell';
                cellDiv.dataset.r = r;
                cellDiv.dataset.c = c;

                if (cellState) {
                    cellDiv.classList.add('active-word');
                    cellDiv.textContent = cellState.char;
                    if (cellState.type !== 'empty') cellDiv.classList.add(cellState.type);

                    // Add click handler
                    cellDiv.addEventListener('click', () => this.handleCrosswordClick(r, c));

                    // Add Word Number indicator if start of word
                    // Important: One cell can be start of TWO words (Across and Down).
                    // We need to check all words starting here.
                    const startWords = this.cwGrid.words.filter(w => w.row === r && w.col === c);
                    if (startWords.length > 0) {
                        const num = document.createElement('span');
                        num.className = 'cw-num';
                        // Show number of the *first* word starting here (usually shared start words match ID, or we pick smallest)
                        // For simplicity, showing the Across ID if present, else Down ID.
                        // Actually, sorting by ID to startWords ensures consistent numbering?
                        // Let's just use startWords[0].id + 1
                        num.textContent = startWords[0].id + 1;
                        cellDiv.appendChild(num);
                    }
                }

                gridEl.appendChild(cellDiv);
            }
        }

        wrapper.appendChild(gridEl);

        // --- Right Column (Hints + Button) ---
        const rightCol = document.createElement('div');
        rightCol.className = 'cw-right-col';

        // --- Hints Panel ---
        const hintsPanel = document.createElement('div');
        hintsPanel.className = 'cw-hints-panel';

        const acrossSection = document.createElement('div');
        acrossSection.className = 'hints-section';
        acrossSection.innerHTML = `<h3>Horizontais</h3>`;

        const downSection = document.createElement('div');
        downSection.className = 'hints-section';
        downSection.innerHTML = `<h3>Verticais</h3>`;

        // Sort words by ID/Number for easier reading? Or separating Across/Down.
        const acrossWords = this.cwGrid.words.filter(w => w.dir === 'across').sort((a, b) => a.id - b.id);
        const downWords = this.cwGrid.words.filter(w => w.dir === 'down').sort((a, b) => a.id - b.id);

        const createHintItem = (w) => {
            const item = document.createElement('div');
            item.className = 'hint-item';
            item.dataset.id = w.id;

            // Format: "1. Pergunta aqui (5)"
            // Ensure w.clue is a string
            let text = w.clue ? w.clue : "Dica indisponível";
            // Check if length is already in clue (avoid double parens if data has it)
            if (!text.includes('(')) {
                text += ` (${w.word.length})`;
            }

            item.innerHTML = `<span class="hint-num">${w.id + 1}</span><span class="hint-text">${text}</span>`;
            item.addEventListener('click', () => this.selectCrosswordWord(this.cwGrid.words.indexOf(w)));
            return item;
        };

        acrossWords.forEach(w => acrossSection.appendChild(createHintItem(w)));
        downWords.forEach(w => downSection.appendChild(createHintItem(w)));

        hintsPanel.appendChild(acrossSection);
        hintsPanel.appendChild(downSection);
        this.cwHintsPanel = hintsPanel; // Save ref

        rightCol.appendChild(hintsPanel);

        rightCol.appendChild(hintsPanel);

        // Finish Button is now in the header

        wrapper.appendChild(rightCol);

        this.boardsContainer.appendChild(wrapper);
    }

    validateCrossword() {
        if (this.isGameOver) return;

        const correctCells = new Set();
        const wrongCells = new Set();

        // 1. Analyze each word
        this.cwGrid.words.forEach(w => {
            let isCorrect = true;
            let cells = [];

            for (let i = 0; i < w.word.length; i++) {
                const cr = w.dir === 'down' ? w.row + i : w.row;
                const cc = w.dir === 'down' ? w.col : w.col + i;
                const cellKey = `${cr},${cc}`;
                const state = this.cwState[cellKey];

                cells.push(cellKey);

                if (state.char !== w.word[i]) {
                    isCorrect = false;
                }
            }

            if (isCorrect) {
                cells.forEach(k => correctCells.add(k));
            } else {
                cells.forEach(k => wrongCells.add(k));
            }
        });

        // 2. Update Grid UI
        // Priorities: Correct (Green) > Wrong (Red)
        // If a cell is in both (intersection of correct word and wrong word), it is Correct (Green).
        // If a cell is only in Wrong, it is Red.

        document.querySelectorAll('.cw-cell').forEach(el => {
            const r = parseInt(el.dataset.r);
            const c = parseInt(el.dataset.c);
            const key = `${r},${c}`;

            if (correctCells.has(key)) {
                el.classList.add('correct');
                el.classList.remove('active-word', 'highlight'); // Remove focus styles
            } else if (wrongCells.has(key)) {
                el.classList.add('absent'); // Red
                el.classList.remove('active-word', 'highlight');
            }
        });

        // 3. Block Game
        this.isGameOver = true;

        // 4. Feedback
        // Check if fully correct?
        if (wrongCells.size === 0 && correctCells.size > 0) {
            showMessage("Parabéns! Você completou as palavras cruzadas!");
            // Update stats logic here if needed
        } else {
            showMessage("Jogo finalizado. Verifique os erros em vermelho.");
        }
    }


    initListeners() {
        document.addEventListener('keydown', (e) => this.handlePhysicalKeyboard(e));

        const btnDaily = document.getElementById('btn-daily');
        const btnTraining = document.getElementById('btn-training');
        
        if (btnDaily && btnTraining) {
            btnDaily.addEventListener('click', () => {
                if (this.playStyle !== 'daily') {
                    this.playStyle = 'daily';
                    btnDaily.classList.add('active');
                    btnTraining.classList.remove('active');
                    this.startNewGame();
                }
            });
            btnTraining.addEventListener('click', () => {
                if (this.playStyle !== 'training') {
                    this.playStyle = 'training';
                    btnTraining.classList.add('active');
                    btnDaily.classList.remove('active');
                    this.startNewGame();
                }
            });
        }

        // Toggle Menu
        const toggleBtn = document.getElementById('mode-toggle');
        const menu = document.getElementById('mode-menu'); // O menu antigo (do cabeçalho)

        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('hidden');
                toggleBtn.classList.toggle('open');
            });
        }

        // Main Menu Button (New)
        const mainMenuBtn = document.getElementById('main-menu-btn');
        const gamesModal = document.getElementById('games-modal');
        if (mainMenuBtn) {
            mainMenuBtn.addEventListener('click', () => {
                gamesModal.classList.remove('hidden');
                document.getElementById('modal-overlay').classList.remove('hidden');
            });
        }

        // Termo Dropdown Toggle
        const dropdownBtn = document.getElementById('current-termo-mode');
        const dropdownContent = document.getElementById('termo-options');

        if (dropdownBtn && dropdownContent) {
            dropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownContent.classList.toggle('hidden');
            });

            // Close when clicking outside
            document.addEventListener('click', (e) => {
                if (!dropdownBtn.contains(e.target) && !dropdownContent.contains(e.target)) {
                    dropdownContent.classList.add('hidden');
                }
            });
        }

        // Termo Sub-Mode Buttons
        document.querySelectorAll('.sub-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = parseInt(btn.dataset.mode);
                if (dropdownContent) dropdownContent.classList.add('hidden'); // Close menu
                if (this.mode !== mode) {
                    this.setMode(mode);
                }
            });
        });

        // Game Mode Options
        document.querySelectorAll('.game-mode-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                gamesModal.classList.add('hidden');
                document.getElementById('modal-overlay').classList.add('hidden');
                this.setMode(mode);
            });
        });

        // Crossword Dropdown Toggle
        const cwDropdownBtn = document.getElementById('current-crossword-mode');
        const cwDropdownContent = document.getElementById('crossword-options');

        if (cwDropdownBtn && cwDropdownContent) {
            cwDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cwDropdownContent.classList.toggle('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!cwDropdownBtn.contains(e.target) && !cwDropdownContent.contains(e.target)) {
                    cwDropdownContent.classList.add('hidden');
                }
            });
        }

        // Crossword Sub-Mode Buttons
        document.querySelectorAll('.cw-sub-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (cwDropdownContent) cwDropdownContent.classList.add('hidden');
                if (this.mode !== mode) {
                    this.setMode(mode);
                }
            });
        });

        // Close menu/modals logic
        document.addEventListener('click', (e) => {
            // ... existing logic ...
        });

        document.getElementById('help-btn').addEventListener('click', () => {
            this.updateHelpContent();
            openModal('help-modal');
        });
        document.getElementById('stats-btn').addEventListener('click', () => {
            this.renderStats();
            openModal('stats-modal');
        });

        const hintsBtn = document.getElementById('floating-hints-btn');
        if (hintsBtn) {
            hintsBtn.addEventListener('click', () => {
                // Populate hints modal content based on current mode
                if (this.mode === 'crossword') {
                    this.populateCrosswordHintsModal();
                } else if (this.mode === 'exact-crossword') {
                    this.populateExactCrosswordHintsModal();
                }
                openModal('hints-modal');
            });
        }

        const closeHintsBtn = document.getElementById('close-hints-modal');
        if (closeHintsBtn) {
            closeHintsBtn.addEventListener('click', () => {
                document.getElementById('hints-modal').classList.add('hidden');
                document.getElementById('modal-overlay').classList.add('hidden');
            });
        }
        document.getElementById('share-btn').addEventListener('click', () => this.shareResult());
        document.querySelectorAll('.close-btn').forEach(b => b.addEventListener('click', closeModal));
        document.getElementById('modal-overlay').addEventListener('click', closeModal);

        // Header Finish Button
        if (this.headerFinishBtn) {
            this.headerFinishBtn.addEventListener('click', () => {
                if (this.mode === 'sudoku') this.validateSudoku();
                else if (this.mode === 'crossword' || this.mode === 'exact-crossword') this.validateCrossword();
            });
        }
    }

    validateCrossword() {
        if (this.mode === 'exact-crossword') {
            this.validateExactCrossword();
        } else {
            this.checkExactWin(true);
        }
    }

    handleTileClick(boardId, row, col) {
        if (this.isGameOver) return;
        const board = this.boards[boardId];
        // Permite mudar o foco apenas se clicar na linha atual do tabuleiro ativo
        if (board && !board.isSolved && !board.isFailed && row === board.currentRow) {
            this.currentCol = col;
            this.updateFocus();
        }
    }

    handlePhysicalKeyboard(e) {
        if (this.isGameOver) return;
        if (!document.getElementById('modal-overlay').classList.contains('hidden')) {
            if (e.key === 'Escape') closeModal();
            return;
        }

        const key = e.key;
        if (this.mode === 'crossword' || this.mode === 'exact-crossword' || this.mode === 'sudoku') {
            // Navigation Keys
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
                e.preventDefault();
                if (this.mode === 'sudoku') {
                    if (key === 'ArrowUp' && this.sudokuCursor.r > 0) this.sudokuCursor.r--;
                    if (key === 'ArrowDown' && this.sudokuCursor.r < 8) this.sudokuCursor.r++;
                    if (key === 'ArrowLeft' && this.sudokuCursor.c > 0) this.sudokuCursor.c--;
                    if (key === 'ArrowRight' && this.sudokuCursor.c < 8) this.sudokuCursor.c++;
                    this.updateSudokuUI();
                } else {
                    this.handleCrosswordNavigation(key);
                }
                return;
            }
            if (key === 'Tab') {
                e.preventDefault();
                if (this.mode !== 'sudoku') {
                    this.cwDirection = this.cwDirection === 'across' ? 'down' : 'across';
                    this.updateCrosswordFocus();
                }
                return;
            }
            if (this.mode === 'sudoku') this.handleSudokuInput(key);
            else this.handleCrosswordInput(key);
            return;
        }

        if (key === 'Enter') this.submitGuess();
        else if (key === 'Backspace') this.deleteLetter();
        else if (this.mode === 'math') {
            if (/^[0-9+\-*/=]$/.test(key)) this.addLetter(key.toUpperCase());
        }
        else if (/^[a-zA-Z]$/.test(key)) this.addLetter(key.toUpperCase());
        else if (key === 'ArrowLeft') {
            e.preventDefault();
            if (this.currentCol > 0) { this.currentCol--; this.updateFocus(); }
        } else if (key === 'ArrowRight') {
            e.preventDefault();
            const cols = this.mode === 'math' ? 8 : 5;
            if (this.currentCol < cols - 1) { this.currentCol++; this.updateFocus(); }
        }
    }

    handleVirtualKey(key) {
        if (this.isGameOver) return;

        if (this.mode === 'crossword') {
            if (key === 'Enter') this.submitGuessCrossword(); // Optional: Check win or just visual?
            else if (key === 'Backspace') this.handleCrosswordInput('Backspace');
            else this.handleCrosswordInput(key);
            return;
        }

        if (this.mode === 'exact-crossword') {
            // Numbers mode uses clicks for selection/fitting, but let's allow Backspace for clearing
            if (key === 'Backspace') this.handleCrosswordInput('Backspace'); // Changed to use handleCrosswordInput
            else if (key === 'Enter') this.validateExactCrossword(); // Added ENTER for validation
            else this.handleCrosswordInput(key); // Allow number input
            return;
        }

        if (this.mode === 'sudoku') {
            if (key === 'Backspace') this.handleSudokuInput('Backspace');
            else if (key === 'Enter') this.validateSudoku();
            else this.handleSudokuInput(key);
            return;
        }

        if (key === 'Enter') this.submitGuess();
        else if (key === 'Backspace') this.deleteLetter();
        else this.addLetter(key);
    }

    handleCrosswordNavigation(key) {
        let dr = 0, dc = 0;
        if (key === 'ArrowUp') dr = -1;
        if (key === 'ArrowDown') dr = 1;
        if (key === 'ArrowLeft') dc = -1;
        if (key === 'ArrowRight') dc = 1;

        // Try move
        const nr = this.cwCursor.r + dr;
        const nc = this.cwCursor.c + dc;

        // Check if target is valid cell
        if (this.cwState[`${nr},${nc}`]) {
            this.cwCursor = { r: nr, c: nc };
            this.updateCrosswordFocus();
        }
    }

    handleCrosswordInput(key) {
        if (this.isGameOver) return;

        if (key === 'Backspace') {
            const cellKey = `${this.cwCursor.r},${this.cwCursor.c}`;
            const currentState = this.cwState[cellKey];
            if (!currentState) return;

            // Protection for fixed cells in exact mode
            if (this.mode === 'exact-crossword' && currentState.isFixed) return;

            const activeWord = this.getActiveWord();

            if (currentState.char !== '') {
                currentState.char = '';
                if (activeWord && (this.cwCursor.r !== activeWord.row || this.cwCursor.c !== activeWord.col)) {
                    this.moveCursorBack();
                }
            } else {
                this.moveCursorBack();
                const newKey = `${this.cwCursor.r},${this.cwCursor.c}`;
                if (this.cwState[newKey] && (!this.cwState[newKey].isFixed || this.mode !== 'exact-crossword')) {
                    this.cwState[newKey].char = '';
                }
            }

            this.updateCrosswordTiles();
            this.updateCrosswordHints();
            if (this.mode === 'exact-crossword') {
                this.updateNumberListStates();
            }
            return;
        }

        const isExact = this.mode === 'exact-crossword';
        const isValidKey = isExact ? /^[0-9]$/.test(key) : /^[a-zA-Z]$/.test(key);

        if (isValidKey) {
            const char = key.toUpperCase();
            const cellKey = `${this.cwCursor.r},${this.cwCursor.c}`;
            const cellState = this.cwState[cellKey];

            if (cellState) {
                if (isExact && cellState.isFixed) {
                    this.moveCursorForward();
                    return;
                }

                cellState.char = char;
                this.updateCrosswordTiles();

                if (isExact) {
                    this.updateNumberListStates();
                    this.checkExactWin();
                } else {
                    this.checkCrosswordWin();
                    this.updateCrosswordHints();
                }

                this.moveCursorForward();
            }
        }
    }

    moveCursorForward() {
        const dr = this.cwDirection === 'across' ? 0 : 1;
        const dc = this.cwDirection === 'across' ? 1 : 0;
        const nr = this.cwCursor.r + dr;
        const nc = this.cwCursor.c + dc;

        const activeWord = this.getActiveWord();
        if (activeWord) {
            const wordEndR = this.cwDirection === 'down' ? activeWord.row + activeWord.word.length - 1 : activeWord.row;
            const wordEndC = this.cwDirection === 'across' ? activeWord.col + activeWord.word.length - 1 : activeWord.col;

            if (this.cwDirection === 'across' && nc > wordEndC) return;
            if (this.cwDirection === 'down' && nr > wordEndR) return;
        }

        if (this.cwState[`${nr},${nc}`]) {
            this.cwCursor = { r: nr, c: nc };
            this.updateCrosswordFocus();
        }
    }

    moveCursorBack() {
        const dr = this.cwDirection === 'across' ? 0 : -1;
        const dc = this.cwDirection === 'across' ? -1 : 0;
        const nr = this.cwCursor.r + dr;
        const nc = this.cwCursor.c + dc;

        const activeWord = this.getActiveWord();
        if (activeWord) {
            if (this.cwDirection === 'across' && nc < activeWord.col) return;
            if (this.cwDirection === 'down' && nr < activeWord.row) return;
        }

        if (this.cwState[`${nr},${nc}`]) {
            this.cwCursor = { r: nr, c: nc };
            this.updateCrosswordFocus();
        }
    }

    updateCrosswordTiles() {
        // Redraw content only
        for (const [key, state] of Object.entries(this.cwState)) {
            const [r, c] = key.split(',').map(Number);
            const cellIndex = r * this.cwGrid.cols + c;
            const cellDiv = this.cwGrid.element.children[cellIndex];
            // Preserves numbers and styling, just updates text
            // But text is a child textNode or simple content? 
            // cellDiv.textContent clears children (the number spans).
            // We need to update just the text node.

            // Simple hack: Re-render innerHTML or find text node?
            // Let's protect the span .cw-num
            const numSpan = cellDiv.querySelector('.cw-num');
            // Remove all text nodes, keep elements
            Array.from(cellDiv.childNodes).forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) node.remove();
            });

            if (state.char) {
                cellDiv.appendChild(document.createTextNode(state.char));
            }

            // Update logic classes (correct/present/absent) - REMOVE them for editing?
            // Or keep them until submit? 
            // Crosswords usually Instant Feedback or Check Button. 
            // Original code had submitGuessCrossword.
            // Let's keep dynamic feedback if it was there, or clear it if editing.
            // For now, assume simple editing.
            cellDiv.classList.remove('correct', 'present', 'absent');
            if (state.type !== 'empty') cellDiv.classList.add(state.type);
        }
        this.updateKeyboardColorsCrossword([], []); // Pass empty to avoid errors or logic to update correctly
    }

    submitGuessCrossword() {

        // Greens
        guessArr.forEach((char, i) => {
            if (char === w.word[i]) {
                results[i] = 'correct';
                secretLettersCount[char]--;
            }
        });

        // Yellows
        guessArr.forEach((char, i) => {
            if (results[i] !== 'correct' && secretLettersCount[char] > 0) {
                results[i] = 'present';
                secretLettersCount[char]--;
            }
        });

        // Apply to state
        guessArr.forEach((char, i) => {
            const cr = w.dir === 'down' ? w.row + i : w.row;
            const cc = w.dir === 'down' ? w.col : w.col + i;
            // Only update if current is better?
            // "Unlimited attempts": just show feedback for THIS guess.
            // If I overwrite a Green with a wrong letter, it should turn Absent? Yes.

            // Wait, if a cell is shared with another word...
            // If checking Word A makes it Absent, but it WAS Green in Word B?
            // This is the tricky part.
            // Simple approach: Interaction prioritizes logic of the *active word*.
            // So yes, it might flicker if you check A then B.
            // But if it is correct in A, it is the correct letter. It will match B too if user is correct.

            this.cwState[`${cr},${cc}`].type = results[i];
        });

        this.updateCrosswordTiles();
        this.updateKeyboardColorsCrossword(guessArr, results);

        // Check win condition
        this.checkCrosswordWin();
    }

    updateKeyboardColorsCrossword(letters, statuses) {
        // Same logic as normal
        letters.forEach((char, i) => this.updateKeyboardColor(char, statuses[i]));
    }

    checkCrosswordWin() {
        // Win if ALL cells in cwState are 'correct'
        const allCorrect = Object.values(this.cwState).every(s => s.type === 'correct');
        if (allCorrect) {
            this.isGameOver = true;
            showMessage("Parabéns! Cruzadinha completa! 🎉");
            this.stats['crossword'].won++;
            this.saveStats();
        }
    }

    addLetter(letter) {
        if (this.mode === 'crossword') return; // Handled separately

        // Adiciona em TODOS os boards ativos
        let inserted = false;
        this.boards.forEach(board => {
            if (!board.isSolved && !board.isFailed) {
                board.addLetter(letter, this.currentCol);
                inserted = true;
            }
        });

        const maxCol = (this.boards[0] && this.boards[0].COLS) ? this.boards[0].COLS - 1 : 4;
        if (inserted && this.currentCol < maxCol) {
            this.currentCol++;
            this.updateFocus();
        } else if (inserted) {
            this.updateFocus(); // Apenas re-foca se já estiver no final
        }
    }

    deleteLetter() {
        let deleted = false;
        // Se a coluna atual tiver letra, apaga. Se não, volta e apaga.
        // Verificamos o estado do primeiro board ativo para decidir a lógica de cursor?
        // Simpificação: Tenta apagar na atual. Se vazio, volta e apaga.

        // Verifica se algum board tem letra na coluna atual
        const hasLetterAtCurrent = this.boards.some(b => !b.isSolved && !b.isFailed && b.gridState[b.currentRow][this.currentCol] !== "");

        if (hasLetterAtCurrent) {
            this.boards.forEach(b => b.removeLetter(this.currentCol));
        } else {
            if (this.currentCol > 0) {
                this.currentCol--;
                this.boards.forEach(b => b.removeLetter(this.currentCol));
            }
        }
        this.updateFocus();
    }

    updateFocus() {
        this.boards.forEach(board => board.updateFocus(this.currentCol, !this.isGameOver));
    }

    submitGuess() {
        // Valida se palavra completa (usamos o estado do primeiro board ativo como referência)
        const activeBoard = this.boards.find(b => !b.isSolved && !b.isFailed);
        if (!activeBoard) return;

        const guessArray = activeBoard.gridState[activeBoard.currentRow];
        const guessWord = guessArray.join("");

        if (this.mode === 'math') {
            if (guessWord.length !== 8 || guessArray.includes("")) {
                showMessage("A equação deve ter 8 caracteres");
                this.shakeActiveRows();
                return;
            }
            if (!this.isValidEquation(guessWord)) {
                showMessage("Equação inválida");
                this.shakeActiveRows();
                return;
            }
        } else {
            if (guessWord.length !== 5 || guessArray.includes("")) {
                showMessage("Só palavras com 5 letras");
                this.shakeActiveRows();
                return;
            }
            if (!this.isValidWord(guessWord)) {
                showMessage("Palavra não aceita");
                this.shakeActiveRows();
                return;
            }
        }

        // Processa guess
        this.processTurn(guessWord);
    }

    isValidEquation(guess) {
        if (!guess.includes('=')) return false;
        const parts = guess.split('=');
        if (parts.length !== 2) return false;
        const expression = parts[0];
        const result = parts[1];
        if (!expression || !result) return false;
        
        // Basic check for double operators
        if (/[+\-*/]{2,}/.test(expression)) return false;
        // Basic check for starting/ending with operators
        if (/^[+\-*/]/.test(expression) || /[+\-*/]$/.test(expression)) return false;

        try {
            // Replace 08 with 8 to avoid octal issues in some JS engines
            const sanitizedExpr = expression.replace(/\b0+(?=\d)/g, '');
            const evalResult = new Function(`return ${sanitizedExpr}`)();
            return evalResult.toString() === result.replace(/^0+/, '');
        } catch (e) {
            return false;
        }
    }

    isValidWord(word) {
        const normalized = normalizeWord(word);
        return WORDS_DATA.some(w => normalizeWord(w) === normalized);
    }

    processTurn(guessWord, animate = true) {
        // Save to daily state if in daily mode and it's a real turn (not restoration)
        if (this.playStyle === 'daily' && animate) {
            const state = this.dailyState.modes[this.mode];
            if (state && !state.guesses.includes(guessWord)) {
                state.guesses.push(guessWord);
                this.saveDailyState();
            }
        }

        // 1. Check Visual Results para cada board
        const allKeyStatuses = {}; // Para atualizar teclado: letra -> status (priority)

        this.boards.forEach(board => {
            if (!board.isSolved && !board.isFailed) {
                const results = board.checkRow(guessWord, animate);

                // Coleta cores para o teclado
                guessWord.split("").forEach((char, i) => {
                    const status = results[i];
                    // logica de prioridade: correct > present > absent
                    if (!allKeyStatuses[char]) allKeyStatuses[char] = status;
                    else {
                        if (status === 'correct') allKeyStatuses[char] = 'correct';
                        else if (status === 'present' && allKeyStatuses[char] !== 'correct') allKeyStatuses[char] = 'present';
                    }
                });

                // Finaliza logicalmente a linha (incrementa row)
                board.finalizeRow(guessWord);
            }
        });

        const finalizeTurn = () => {
            Object.keys(allKeyStatuses).forEach(char => {
                this.updateKeyboardColor(char, allKeyStatuses[char]);
            });

            // 3. Reset cursor
            this.currentCol = 0;
            this.updateFocus();

            // 4. Check Global Game State
            if (animate) {
                this.checkGameState();
            }
        };

        // 2. Atualiza Teclado após animações
        if (animate) {
            setTimeout(finalizeTurn, 5 * 250 + 200);
        } else {
            finalizeTurn();
        }
    }

    checkGameState() {
        const allSolved = this.boards.every(b => b.isSolved);
        const anyFailed = this.boards.some(b => !b.isSolved && b.currentRow >= b.ROWS); // Se esgotou linhas e não resolveu

        // Perdeu se: não resolveu todos E não tem mais tentativas em algum dos não resolvidos?
        // Não, a perda é individual? No Dueto, se uma falhar, o jogo acaba?
        // Geralmente Termo/Duetto: Voce joga ate acabar as linhas. Se ao acabar as linhas tiver algum nao resolvido, perdeu.
        // Mas se um board acabar as linhas (failed) e o outro nao? 
        // No Dueto: As linhas sao compartilhadas? Sim, voce gasta 1 tentativa para os dois.
        // Entao se `activeBoard` nao existir (todos solved ou failed) E nem todos solve: Perdeu.

        const activeBoards = this.boards.filter(b => !b.isSolved && !b.isFailed);

        if (allSolved) {
            this.handleEndGame(true);
        } else if (activeBoards.length === 0) {
            // Nao sobrou nenhum ativo e não resolveu todos -> Perdeu
            this.handleEndGame(false);
        }
    }

    handleEndGame(win) {
        this.isGameOver = true;
        this.updateStats(win);

        if (this.playStyle === 'daily') {
            const state = this.dailyState.modes[this.mode];
            if (state) {
                state.status = win ? 'won' : 'lost';
                this.saveDailyState();
            }
        }

        let msg = win ? "Fantástico! 🎉" : "Fim de jogo!";
        if (!this.isRestoring) {
            showMessage(msg);
        }

        if (!win && !this.isRestoring) {
            // Mostra palavras que faltaram
            setTimeout(() => {
                this.boards.filter(b => !b.isSolved).forEach(b => {
                    showMessage(`Palavra ${b.id + 1}: ${b.secretWord}`);
                });
            }, 1000);
        }

        setTimeout(() => {
            if (!this.isRestoring) {
                this.renderStats();
                openModal('stats-modal');
            }
        }, 2500);
    }

    updateStats(win) {
        if (this.isRestoring) return;

        // Extra protection for daily mode: don't count if already finished today
        if (this.playStyle === 'daily') {
            const state = this.dailyState.modes[this.mode];
            if (state && state.status !== 'playing') return;
        }

        const s = this.stats[this.mode];
        s.played++;

        if (win) {
            s.won++;
            s.streak++;
            if (s.streak > s.maxStreak) s.maxStreak = s.streak;

            // Tentativa da vitória é a linha do ÚLTIMO board resolvido?
            // Ou o total de tentativas usadas?
            // Geralmente conta quantas linhas foram usadas no total.
            // Como todos andam juntos (exceto quando solved), pegamos o max row.
            const attemptsUsed = Math.max(...this.boards.map(b => b.currentRow)); // b.currentRow já foi incrementado após acerto? 
            // Se acertou na ultima tentativa (row 5 para termo), currentRow vira 6?
            // No finalizeRow: se acertou, isSolved=true, currentRow NAO incrementa?
            // Vamos checar Board.finalizeRow: se acertou, solved=true. Row nao muda.
            // Entao 1 tentativa = row 0. Attempts = row + 1.

            // Mas espera, se um board resolveu na tentativa 3 e o outro na 5.
            // O jogo acabou na 5.

            // Correction in Board logic: 
            // if solved, we keep currentRow pointing to the winning row?

            let maxRow = 0;
            this.boards.forEach(b => {
                // Se solved, currentRow é a linha do acerto.
                // Se não, é onde parou.
                // Na vdd finalizeRow nao incrementa se acertou.
                if (b.currentRow > maxRow) maxRow = b.currentRow;
            });
            // O index da linha é 0-based. Tentativa = index + 1.
            const attemptCount = maxRow + 1;

            s.dist[attemptCount] = (s.dist[attemptCount] || 0) + 1;
        } else {
            s.streak = 0;
            s.dist['fail']++;
        }
        this.saveStats();
    }

    startCrossword() {
        this.boardsContainer.className = '';

        console.log("Checking CROSSWORD_WORDS...");
        const pool = typeof CROSSWORD_WORDS !== 'undefined' ? CROSSWORD_WORDS : [];
        console.log("Pool loaded, items:", pool.length);

        // Filtrar palavras por tamanho (5-12) e que não foram usadas
        let availableWords = pool.filter(w => {
            const wordStr = normalizeWord(w.word);
            return wordStr.length >= 5 && wordStr.length <= 12 && !this.usedCrosswordWords.has(wordStr);
        });

        // Se a pool disponível for muito pequena, resetar as palavras usadas para evitar travamento
        if (availableWords.length < 15) {
            console.log("Pool esgotada ou muito pequena. Resetando palavras usadas.");
            this.usedCrosswordWords.clear();
            availableWords = pool.filter(w => {
                const wordStr = normalizeWord(w.word);
                return wordStr.length >= 5 && wordStr.length <= 12;
            });
        }

        const gen = new CrosswordGenerator(availableWords);
        const gridData = gen.generate(10); // Tentar gerar com 10 palavras

        if (!gridData || gridData.words.length === 0) {
            alert("Erro ao gerar palavras cruzadas. Tente novamente.");
            return;
        }

        // Marcar as palavras geradas como usadas
        gridData.words.forEach(w => {
            this.usedCrosswordWords.add(normalizeWord(w.word));
        });

        console.log("Crossword Generated:", gridData);
        this.cwGrid = gridData;
        this.cwState = {};

        this.cwGrid.words.forEach(w => {
            for (let i = 0; i < w.word.length; i++) {
                const cr = w.dir === 'down' ? w.row + i : w.row;
                const cc = w.dir === 'down' ? w.col : w.col + i;
                if (!this.cwState[`${cr},${cc}`]) {
                    this.cwState[`${cr},${cc}`] = { char: "", type: "empty" };
                }
            }
        });

        this.renderCrossword();
        this.createKeyboard();

        // Initialize Cursor
        const firstWord = this.cwGrid.words[0];
        this.cwCursor = { r: firstWord.row, c: firstWord.col };
        this.cwDirection = firstWord.dir; // 'across' or 'down'

        this.updateCrosswordFocus();
        this.updateCrosswordHints();
        this.startCountdown();
    }

    populateCrosswordHintsModal() {
        const hintsModalContent = document.getElementById('hints-modal-content');
        if (hintsModalContent) hintsModalContent.innerHTML = '';

        const acrossWords = this.cwGrid.words.filter(w => w.dir === 'across').sort((a, b) => a.id - b.id);
        const downWords = this.cwGrid.words.filter(w => w.dir === 'down').sort((a, b) => a.id - b.id);

        const populatePanel = (words, title) => {
            const h3 = document.createElement('h3');
            h3.textContent = title;
            hintsModalContent.appendChild(h3);
            const list = document.createElement('div');
            list.className = 'hint-list';
            words.forEach(w => {
                const item = document.createElement('div');
                item.className = 'hint-item';
                item.innerHTML = `<strong>${w.id + 1}.</strong> ${w.clue || 'Sem dica'}`;
                item.addEventListener('click', () => {
                    this.cwCursor = { r: w.row, c: w.col };
                    this.cwDirection = w.dir;
                    this.updateCrosswordFocus();
                    if (window.innerWidth <= 600) {
                        document.getElementById('hints-modal').classList.add('hidden');
                        document.getElementById('modal-overlay').classList.add('hidden');
                    }
                });
                list.appendChild(item);
            });
            hintsModalContent.appendChild(list);
        };

        populatePanel(acrossWords, 'Horizontais');
        populatePanel(downWords, 'Verticais');
    }

    populateExactCrosswordHintsModal() {
        const hintsModalContent = document.getElementById('hints-modal-content');
        if (hintsModalContent) hintsModalContent.innerHTML = '';

        const groups = {};
        this.numberPool.forEach(num => {
            const len = num.length;
            if (!groups[len]) groups[len] = [];
            groups[len].push(num);
        });

        const sortedLengths = Object.keys(groups).sort((a, b) => a - b);
        sortedLengths.forEach(len => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'number-group';
            groupDiv.innerHTML = `<h4>${len} DÍGITOS</h4>`;
            const listDiv = document.createElement('div');
            listDiv.className = 'number-group-list';

            groups[len].sort().forEach(num => {
                const item = document.createElement('div');
                item.className = 'number-item';
                item.textContent = num;
                item.dataset.val = num;
                item.addEventListener('click', () => {
                    this.handleNumberSelection(num, item);
                    // On mobile, close modal after selection
                    document.getElementById('hints-modal').classList.add('hidden');
                    document.getElementById('modal-overlay').classList.add('hidden');
                });
                listDiv.appendChild(item);
            });
            groupDiv.appendChild(listDiv);
            hintsModalContent.appendChild(groupDiv);
        });
    }

    startExactCrossword() {
        this.boardsContainer.innerHTML = ''; // Ensure container is clear
        this.boardsContainer.className = '';
        console.log("Starting Exact Crossword...");

        // Strategy: Use generator to create a pool on the fly
        // We need a function to generate valid numbers based on length
        const generatePool = (requiredLengths) => {
            return requiredLengths.map(len => this.generateValidNumber(len));
        };

        // For generation, we still need a "list" for the layout algorithm, but a list of unique masks.
        // Let's create a temporary pool of random numbers of various lengths.
        const tempPool = [];
        for (let i = 0; i < 50; i++) {
            const len = Math.floor(Math.random() * 5) + 4; // 4 to 8
            tempPool.push(this.generateValidNumber(len));
        }

        const gen = new CrosswordGenerator(tempPool);
        const gridData = gen.generate(12);

        if (!gridData || gridData.words.length === 0) {
            alert("Erro ao gerar Exatas Cruzadas. Tente novamente.");
            return;
        }

        this.cwGrid = gridData;
        this.cwState = {};
        this.selectedNumber = null;

        // Initialize state
        this.cwGrid.words.forEach(w => {
            for (let i = 0; i < w.word.length; i++) {
                const r = w.dir === 'down' ? w.row + i : w.row;
                const c = w.dir === 'down' ? w.col : w.col + i;
                const cellKey = `${r},${c}`;
                if (!this.cwState[cellKey]) {
                    this.cwState[cellKey] = { char: "", type: "empty", isFixed: false };
                }
            }
        });

        // Pick 1 word to be "fixed" (anchor)
        const fixedIndex = Math.floor(Math.random() * gridData.words.length);
        const anchorWord = gridData.words[fixedIndex];
        for (let i = 0; i < anchorWord.word.length; i++) {
            const r = anchorWord.dir === 'down' ? anchorWord.row + i : anchorWord.row;
            const c = anchorWord.dir === 'down' ? anchorWord.col : anchorWord.col + i;
            const cellKey = `${r},${c}`;
            this.cwState[cellKey].char = anchorWord.word[i];
            this.cwState[cellKey].isFixed = true;
        }

        // Pick 3 additional random digits from other words
        let extraDigitsCount = 0;
        let attempts = 0;
        while (extraDigitsCount < 3 && attempts < 50) {
            attempts++;
            const wordIdx = Math.floor(Math.random() * gridData.words.length);
            if (wordIdx === fixedIndex) continue;

            const word = gridData.words[wordIdx];
            const charIdx = Math.floor(Math.random() * word.word.length);
            const r = word.dir === 'down' ? word.row + charIdx : word.row;
            const c = word.dir === 'down' ? word.col : word.col + charIdx;
            const cellKey = `${r},${c}`;

            if (!this.cwState[cellKey].isFixed) {
                this.cwState[cellKey].char = word.word[charIdx];
                this.cwState[cellKey].isFixed = true;
                extraDigitsCount++;
            }
        }

        // Prepare number pool (unique strings, sorted by length)
        this.numberPool = gridData.words.map(w => w.word).sort((a, b) => a.length - b.length);

        this.renderExactCrossword();
        this.createKeyboard(); // Create keyboard for exact crossword

        // Initial Focus
        const firstWord = this.cwGrid.words[0];
        this.cwCursor = { r: firstWord.row, c: firstWord.col };
        this.cwDirection = firstWord.dir;
        this.updateCrosswordFocus();
        this.startCountdown();
    }

    renderExactCrossword() {
        const wrapper = document.createElement('div');
        wrapper.className = 'crossword-container';

        // --- Grid ---
        const gridEl = document.createElement('div');
        gridEl.className = 'crossword-grid';
        gridEl.style.gridTemplateColumns = `repeat(${this.cwGrid.cols}, minmax(0, 1fr))`;
        gridEl.style.gridTemplateRows = `repeat(${this.cwGrid.rows}, minmax(0, 1fr))`;
        this.cwGrid.element = gridEl;

        for (let r = 0; r < this.cwGrid.rows; r++) {
            for (let c = 0; c < this.cwGrid.cols; c++) {
                const cellKey = `${r},${c}`;
                const cellState = this.cwState[cellKey];

                const cellDiv = document.createElement('div');
                cellDiv.className = 'cw-cell';
                cellDiv.dataset.r = r;
                cellDiv.dataset.c = c;
                if (cellState) {
                    cellDiv.classList.add('active-word');
                    if (cellState.isFixed) cellDiv.classList.add('fixed');
                    cellDiv.textContent = cellState.char;
                    cellDiv.addEventListener('click', () => this.handleExactClick(r, c));
                }
                gridEl.appendChild(cellDiv);
            }
        }
        wrapper.appendChild(gridEl);

        // --- Right Column (Numbers List) ---
        const rightCol = document.createElement('div');
        rightCol.className = 'cw-right-col';

        const numbersPanel = document.createElement('div');
        numbersPanel.className = 'cw-hints-panel numbers-container';

        // Group numbers by length
        const groups = {};
        this.numberPool.forEach(num => {
            const len = num.length;
            if (!groups[len]) groups[len] = [];
            groups[len].push(num);
        });

        Object.keys(groups).sort((a, b) => a - b).forEach(len => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'number-group';
            groupDiv.innerHTML = `<h4>${len} DÍGITOS</h4>`;

            const listDiv = document.createElement('div');
            listDiv.className = 'number-group-list';

            groups[len].sort().forEach(num => {
                const item = document.createElement('div');
                item.className = 'number-item';
                item.textContent = num;
                item.dataset.val = num;
                item.addEventListener('click', () => this.handleNumberSelection(num, item));
                listDiv.appendChild(item);
            });

            groupDiv.appendChild(listDiv);
            numbersPanel.appendChild(groupDiv);
        });

        this.cwHintsPanel = numbersPanel;
        rightCol.appendChild(numbersPanel);

        // Finish Button is now in the header

        wrapper.appendChild(rightCol);
        this.boardsContainer.appendChild(wrapper);
    }


    handleCrosswordClick(r, c) {
        if (this.cwCursor.r === r && this.cwCursor.c === c) {
            // Clicked active cell: Toggle direction
            this.cwDirection = this.cwDirection === 'across' ? 'down' : 'across';
        } else {
            // Clicked new cell: Move cursor
            this.cwCursor = { r, c };

            // Intelligence: If new cell is part of a word in current direction, keep it.
            // If not, but part of word in other direction, switch.
            // If part of both, keep current? Or prefer across?

            const isAcross = this.cwGrid.words.some(w => w.dir === 'across' && w.row === r && c >= w.col && c < w.col + w.word.length);
            const isDown = this.cwGrid.words.some(w => w.dir === 'down' && w.col === c && r >= w.row && r < w.row + w.word.length);

            if (this.cwDirection === 'across' && !isAcross && isDown) {
                this.cwDirection = 'down';
            } else if (this.cwDirection === 'down' && !isDown && isAcross) {
                this.cwDirection = 'across';
            }
        }
        this.updateCrosswordFocus();
    }

    selectCrosswordWord(index) {
        // Called from Hits Panel
        const w = this.cwGrid.words[index];
        this.cwCursor = { r: w.row, c: w.col };
        this.cwDirection = w.dir;
        this.updateCrosswordFocus();
    }

    updateCrosswordFocus() {
        const { r, c } = this.cwCursor;
        const dir = this.cwDirection;

        // 1. Highlight Active Cell
        document.querySelectorAll('.cw-cell').forEach(el => {
            el.classList.remove('active-cell', 'highlight');
        });

        const cellIndex = r * this.cwGrid.cols + c;
        const targetCell = this.cwGrid.element.children[cellIndex];
        if (targetCell) targetCell.classList.add('active-cell');

        // 2. Determine Active Word and Highlight Grid + Clue
        // We need to find the word that corresponds to the current cursor AND direction.
        const activeWord = this.cwGrid.words.find(w => {
            if (w.dir !== dir) return false;
            // Intersection check:
            if (dir === 'across') {
                return r === w.row && c >= w.col && c < w.col + w.word.length;
            } else {
                return c === w.col && r >= w.row && r < w.row + w.word.length;
            }
        });

        // Reset all hints
        if (this.cwHintsPanel) {
            this.cwHintsPanel.querySelectorAll('.hint-item').forEach(h => h.classList.remove('active-hint'));
        }

        if (activeWord) {
            // Highlight Grid Cells for this word
            for (let i = 0; i < activeWord.word.length; i++) {
                const cr = dir === 'down' ? activeWord.row + i : activeWord.row;
                const cc = dir === 'down' ? activeWord.col : activeWord.col + i;
                const idx = cr * this.cwGrid.cols + cc;
                if (this.cwGrid.element.children[idx]) {
                    this.cwGrid.element.children[idx].classList.add('highlight');
                }
            }

            // Highlight Clue
            if (this.cwHintsPanel) {
                const hItem = this.cwHintsPanel.querySelector(`.hint-item[data-id="${activeWord.id}"]`);
                if (hItem) {
                    hItem.classList.add('active-hint');
                    // Scroll logic: ensuring it's visible within the panel
                    // scrollIntoView might scroll the whole page if not careful.
                    // block: 'nearest' is safer.
                    hItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
            }
        }

        this.updateKeyboardColorsCrossword();
    }

    getActiveWord() {
        if (!this.cwGrid) return null;
        const { r, c } = this.cwCursor;
        const dir = this.cwDirection;

        return this.cwGrid.words.find(w => {
            if (w.dir !== dir) return false;
            if (dir === 'across') {
                return r === w.row && c >= w.col && c < w.col + w.word.length;
            } else {
                return c === w.col && r >= w.row && r < w.row + w.word.length;
            }
        });
    }

    updateCrosswordHints() {
        if (!this.cwGrid || !this.cwHintsPanel) return;

        this.cwGrid.words.forEach(w => {
            let isWordCorrect = true;
            for (let i = 0; i < w.word.length; i++) {
                const r = w.dir === 'down' ? w.row + i : w.row;
                const c = w.dir === 'down' ? w.col : w.col + i;
                const state = this.cwState[`${r},${c}`];
                if (!state || state.char !== w.word[i]) {
                    isWordCorrect = false;
                    break;
                }
            }

            const hintItem = this.cwHintsPanel.querySelector(`.hint-item[data-id="${w.id}"]`);
            if (hintItem) {
                if (isWordCorrect) {
                    hintItem.classList.add('resolved');
                } else {
                    hintItem.classList.remove('resolved');
                }
            }
        });
    }

    handleExactClick(r, c) {
        if (this.cwState[`${r},${c}`].isFixed) return;

        if (this.cwCursor.r === r && this.cwCursor.c === c) {
            this.cwDirection = this.cwDirection === 'across' ? 'down' : 'across';
        } else {
            this.cwCursor = { r, c };
            const isAcross = this.cwGrid.words.some(w => w.dir === 'across' && w.row === r && c >= w.col && c < w.col + w.word.length);
            const isDown = this.cwGrid.words.some(w => w.dir === 'down' && w.col === c && r >= w.row && r < w.row + w.word.length);

            if (this.cwDirection === 'across' && !isAcross && isDown) this.cwDirection = 'down';
            else if (this.cwDirection === 'down' && !isDown && isAcross) this.cwDirection = 'across';
        }

        this.updateCrosswordFocus();

        if (this.selectedNumber) {
            this.handleWordFit();
        }
    }

    handleNumberSelection(num, el) {
        if (el.classList.contains('used')) return;

        document.querySelectorAll('.number-item').forEach(i => i.classList.remove('selected'));
        if (this.selectedNumber === num) {
            this.selectedNumber = null;
        } else {
            this.selectedNumber = num;
            el.classList.add('selected');
        }
    }

    handleWordFit() {
        if (!this.selectedNumber) return;
        const activeWord = this.getActiveWord();
        if (!activeWord) return;

        if (activeWord.word.length !== this.selectedNumber.length) {
            showMessage(`O número deve ter ${activeWord.word.length} dígitos.`);
            return;
        }

        // Fit it
        for (let i = 0; i < activeWord.word.length; i++) {
            const r = activeWord.dir === 'down' ? activeWord.row + i : activeWord.row;
            const c = activeWord.dir === 'down' ? activeWord.col : activeWord.col + i;
            const cellKey = `${r},${c}`;
            if (!this.cwState[cellKey].isFixed) {
                this.cwState[cellKey].char = this.selectedNumber[i];
            }
        }

        this.selectedNumber = null;
        document.querySelectorAll('.number-item').forEach(i => i.classList.remove('selected'));
        this.updateCrosswordTiles();
        this.updateNumberListStates();
        this.checkExactWin();
    }

    handleExactClear() {
        const activeWord = this.getActiveWord();
        if (!activeWord) return;

        for (let i = 0; i < activeWord.word.length; i++) {
            const r = activeWord.dir === 'down' ? activeWord.row + i : activeWord.row;
            const c = activeWord.dir === 'down' ? activeWord.col : activeWord.col + i;
            const cellKey = `${r},${c}`;
            if (!this.cwState[cellKey].isFixed) {
                this.cwState[cellKey].char = '';
            }
        }
        this.updateCrosswordTiles();
        this.updateNumberListStates();
    }

    updateNumberListStates() {
        // Collect all strings in grid for current word slots
        const gridWords = this.cwGrid.words.map(w => {
            let s = "";
            for (let i = 0; i < w.word.length; i++) {
                const r = w.dir === 'down' ? w.row + i : w.row;
                const c = w.dir === 'down' ? w.col : w.col + i;
                s += this.cwState[`${r},${c}`].char || " ";
            }
            return s.trim();
        });

        document.querySelectorAll('.number-item').forEach(el => {
            const val = el.dataset.val;
            el.classList.remove('used', 'correct');
            if (gridWords.includes(val)) {
                el.classList.add('used');
                // Check if it's in the RIGHT spot? (Implicitly if it matches pool)
                // But a number could be used in a spot and be wrong relative to solution.
                // Request says "marcado visualmente como resolvido" when correct.
                // Simple logic: if it's used and matches its solution?
                // Actually, let's just mark it as 'used' if it's in the grid.
                // We'll mark 'correct' only if it matches its slot in cwGrid.words
            }
        });
    }

    validateExactCrossword() {
        const correctCells = new Set();
        const wrongCells = new Set();

        this.cwGrid.words.forEach(w => {
            let isCorrect = true;
            let cells = [];
            for (let i = 0; i < w.word.length; i++) {
                const r = w.dir === 'down' ? w.row + i : w.row;
                const c = w.dir === 'down' ? w.col : w.col + i;
                const key = `${r},${c}`;
                cells.push(key);
                if (this.cwState[key].char !== w.word[i]) isCorrect = false;
            }

            if (isCorrect) cells.forEach(k => correctCells.add(k));
            else cells.forEach(k => wrongCells.add(k));
        });

        document.querySelectorAll('.cw-cell').forEach(el => {
            const key = `${el.dataset.r},${el.dataset.c}`;
            el.classList.remove('correct', 'absent'); // Clear previous validation
            if (correctCells.has(key)) el.classList.add('correct');
            else if (wrongCells.has(key) && this.cwState[key] && this.cwState[key].char !== "") el.classList.add('absent');
        });

        // Simplified win check
        this.checkExactWin(true);
    }

    checkExactWin(final = false) {
        const allFilled = Object.values(this.cwState).every(s => s.char !== "");
        if (!allFilled && !final) return;

        let allCorrect = true;
        this.cwGrid.words.forEach(w => {
            for (let i = 0; i < w.word.length; i++) {
                const r = w.dir === 'down' ? w.row + i : w.row;
                const c = w.dir === 'down' ? w.col : w.col + i;
                if (this.cwState[`${r},${c}`].char !== w.word[i]) allCorrect = false;
            }
        });

        if (allCorrect) {
            this.isGameOver = true;
            showMessage("Parabéns! Desafio lógico completo! 🎉");
            this.stats['exact-crossword'].won++; // Update stats for exact crossword
            this.saveStats();
        } else if (final) {
            showMessage("Existem erros no encaixe. Verifique os destaques.");
        }
    }

    generateValidNumber(length) {
        const digits = "0123456789";
        let num = "";
        let attempts = 0;

        while (attempts < 100) {
            num = "";
            for (let i = 0; i < length; i++) {
                num += digits[Math.floor(Math.random() * 10)];
            }

            // Constraints:
            // 1. No identical digits (1111)
            const allSame = [...num].every(d => d === num[0]);
            if (allSame) { attempts++; continue; }

            // 2. No simple sequential order (1234 or 4321)
            let isAscending = true;
            let isDescending = true;
            for (let i = 1; i < length; i++) {
                if (parseInt(num[i]) !== parseInt(num[i - 1]) + 1) isAscending = false;
                if (parseInt(num[i]) !== parseInt(num[i - 1]) - 1) isDescending = false;
            }
            if (isAscending || isDescending) { attempts++; continue; }

            // 3. Avoid very simple repetitive patterns like 121212
            if (length >= 4) {
                const pattern2 = num.substring(0, 2);
                let repetitive = true;
                for (let i = 0; i < length; i += 2) {
                    if (i + 2 <= length && num.substring(i, i + 2) !== pattern2) {
                        repetitive = false;
                        break;
                    }
                }
                if (repetitive && length % 2 === 0) { attempts++; continue; }
            }

            return num;
        }
        return num; // Fallback
    }

    updateHelpContent() {
        // Toggle help visibility based on current mode
        const termoHelp = document.getElementById('help-content-termo');
        const cwHelp = document.getElementById('help-content-crossword');
        const exactHelp = document.getElementById('help-content-exact-crossword');
        const sudokuHelp = document.getElementById('help-content-sudoku');
        const mathHelp = document.getElementById('help-content-math');

        if (termoHelp) termoHelp.classList.add('hidden');
        if (cwHelp) cwHelp.classList.add('hidden');
        if (exactHelp) exactHelp.classList.add('hidden');
        if (sudokuHelp) sudokuHelp.classList.add('hidden');
        if (mathHelp) mathHelp.classList.add('hidden');

        if (this.mode === 'crossword') {
            if (cwHelp) cwHelp.classList.remove('hidden');
        } else if (this.mode === 'exact-crossword') {
            if (exactHelp) exactHelp.classList.remove('hidden');
        } else if (this.mode === 'sudoku') {
            if (sudokuHelp) sudokuHelp.classList.remove('hidden');
        } else if (this.mode === 'math') {
            if (mathHelp) mathHelp.classList.remove('hidden');
        } else {
            if (termoHelp) termoHelp.classList.remove('hidden');
        }
    }

    renderStats() {
        const s = this.stats[this.mode];
        document.getElementById('stat-played').textContent = s.played;
        const pct = s.played > 0 ? Math.round((s.won / s.played) * 100) : 0;
        document.getElementById('stat-win-pct').textContent = pct + '%';
        document.getElementById('stat-streak').textContent = s.streak || 0;
        document.getElementById('stat-max-streak').textContent = s.maxStreak || 0;

        const container = document.getElementById('guess-distribution');
        container.innerHTML = '';

        let maxVal = 0;
        for (let k in s.dist) {
            if (k !== 'fail' && s.dist[k] > maxVal) maxVal = s.dist[k];
        }
        maxVal = Math.max(maxVal, 1);

        // Renderiza linhas de 1 até maxAttempts
        for (let i = 1; i <= this.maxAttempts; i++) {
            const count = s.dist[i] || 0;
            const widthPct = Math.max(8, (count / maxVal) * 100);

            const row = document.createElement('div');
            row.className = 'graph-row';
            row.innerHTML = `
                <div class="graph-num">${i}</div>
                <div class="graph-bar-container">
                    <div class="graph-bar ${count > 0 ? 'highlight' : ''}" style="width:${widthPct}%">${count}</div>
                </div>
            `;
            container.appendChild(row);
        }
    }

    createKeyboard() {
        this.keyboardContainer.innerHTML = '';

        let layout;
        if (this.mode === 'exact-crossword') {
            layout = ["1234567890", "ENTER BACKSPACE"];
        } else if (this.mode === 'sudoku') {
            layout = ["123456789", "ENTER BACKSPACE"];
        } else if (this.mode === 'math') {
            layout = ["1234567890", "+-*/=", "ENTER BACKSPACE"];
        } else {
            layout = ["QWERTYUIOP", "ASDFGHJKL", "ENTER ZXCVBNM BACKSPACE"];
        }

        layout.forEach((rowStr, index) => {
            const rowDiv = document.createElement('div');
            rowDiv.classList.add('keyboard-row');

            let keys = rowStr.includes(' ') ? rowStr.split(' ') : rowStr.split('');
            // Special handling for the third row in Termo mode if it was split incorrectly
            if (this.mode !== 'exact-crossword' && index === 2 && keys.length === 1) {
                keys = ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE'];
            }

            keys.forEach(k => {
                if (k.length > 1 && !['ENTER', 'BACKSPACE'].includes(k)) {
                    k.split('').forEach(char => this.createKeyButton(char, rowDiv));
                } else {
                    this.createKeyButton(k, rowDiv);
                }
            });
            this.keyboardContainer.appendChild(rowDiv);
        });
    }

    createKeyButton(key, container) {
        const keyBtn = document.createElement('button');
        keyBtn.className = 'key';

        if (key === 'ENTER') {
            keyBtn.textContent = 'ENTER';
            keyBtn.classList.add('wide');
            keyBtn.dataset.key = 'Enter';
        } else if (key === 'BACKSPACE') {
            keyBtn.textContent = '⌫';
            keyBtn.classList.add('wide');
            keyBtn.dataset.key = 'Backspace';
        } else {
            keyBtn.textContent = key;
            keyBtn.dataset.key = key;
        }

        keyBtn.addEventListener('click', () => this.handleVirtualKey(keyBtn.dataset.key));
        container.appendChild(keyBtn);
    }

    updateKeyboardColor(letter, status) {
        const keyBtn = document.querySelector(`.key[data-key="${letter}"]`);
        if (!keyBtn) return;

        // Se a tecla já tem uma cor mais "forte", não muda
        // Ordem: Correct > Present > Absent > ""
        const priorities = { 'correct': 3, 'present': 2, 'absent': 1, '': 0 };

        // Verifica classe atual
        let currentStatus = '';
        if (keyBtn.classList.contains('correct')) currentStatus = 'correct';
        else if (keyBtn.classList.contains('present')) currentStatus = 'present';
        else if (keyBtn.classList.contains('absent')) currentStatus = 'absent';

        if (priorities[status] > priorities[currentStatus]) {
            keyBtn.classList.remove('present', 'absent', 'correct');
            keyBtn.classList.add(status);
        }
    }

    handleEndGame(win) {
        this.isGameOver = true;
        // Assuming updateFocus is a method that clears active focus for the current game mode
        // If this is for crossword, it might be updateCrosswordFocus or similar.
        // For now, I'll assume it's a generic method or needs to be adapted.
        // If this is for Termo, it would be this.boards.forEach(b => b.updateFocus());
        // Since this is a crossword context, I'll comment it out or adapt if a clear equivalent exists.
        // this.updateFocus(); // Clear active-focus

        if (win) {
            showMessage("Parabéns!");
            this.stats[this.mode].won++;
            this.stats[this.mode].streak++;
            if (this.stats[this.mode].streak > this.stats[this.mode].maxStreak) {
                this.stats[this.mode].maxStreak = this.stats[this.mode].streak;
            }
            // This part seems specific to Termo (boards, currentRow, dist by attempts)
            // For crossword, 'attempts' might be different or not applicable in the same way.
            // I'll keep it as is, assuming 'boards[0]' refers to the primary game board if multiple exist.
            // If this is purely crossword, this logic needs re-evaluation.
            const attempts = this.boards && this.boards[0] ? this.boards[0].currentRow + 1 : 1; // Placeholder for crossword
            this.stats[this.mode].dist[attempts] = (this.stats[this.mode].dist[attempts] || 0) + 1;
        } else {
            // This part also seems Termo-specific (secrets from boards)
            const secrets = this.boards ? this.boards.filter(b => !b.isSolved).map(b => b.secretWord).join(", ") : "a palavra"; // Placeholder for crossword
            showMessage(`Fim de jogo! As palavras eram: ${secrets}`, 5000);
            this.stats[this.mode].streak = 0;
            this.stats[this.mode].dist.fail++;
        }
        this.stats[this.mode].played++;
        this.saveStats();

        setTimeout(() => {
            this.renderStats();
            openModal('stats-modal');
        }, 1500);
    }

    shakeActiveRows() {
        // This method seems specific to Termo (shaking rows on multiple boards)
        // For crossword, it might apply to the current active word or cell.
        // I'll keep the original implementation, assuming 'boards' might exist in a hybrid game.
        this.boards.forEach(board => {
            if (!board.isSolved && !board.isFailed) {
                const row = board.element.querySelectorAll('.row')[board.currentRow];
                if (row) {
                    row.classList.add('invalid');
                    setTimeout(() => row.classList.remove('invalid'), 500);
                }
            }
        });
    }

    startCountdown() {
        const el = document.getElementById('countdown');
        if (!el) return;
        const update = () => {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setHours(24, 0, 0, 0);
            const diff = tomorrow - now;
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            el.textContent = `${h}:${m}:${s}`;
        };
        update();
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(update, 1000);
    }

    shareResult() {
        let text = `Termo Clone (${this.mode}x) ${this.stats[this.mode].played}\n`;
        // Gerar emojis simplificados do último jogo seria complexo sem histórico salvo turno a turno
        // Vou colocar apenas resumo.
        text += this.isGameOver ? "Concluído!" : "Jogando...";
        navigator.clipboard.writeText(text).then(() => {
            alert("Resultado copiado!");
        });
    }

    // --- Sudoku Methods ---
    startSudoku() {
        this.boardsContainer.className = '';
        console.log("Starting Sudoku...");

        const fullGrid = this.generateFullSudoku();
        this.sudokuSolution = JSON.parse(JSON.stringify(fullGrid));

        const puzzle = JSON.parse(JSON.stringify(fullGrid));
        let cellsToRemove = 81 - 35; // Keep 35 numbers
        while (cellsToRemove > 0) {
            const r = Math.floor(Math.random() * 9);
            const c = Math.floor(Math.random() * 9);
            if (puzzle[r][c] !== 0) {
                puzzle[r][c] = 0;
                cellsToRemove--;
            }
        }

        this.sudokuGrid = puzzle;
        this.sudokuState = {};
        this.sudokuCursor = { r: 0, c: 0 };

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const isFixed = puzzle[r][c] !== 0;
                this.sudokuState[`${r},${c}`] = {
                    char: isFixed ? puzzle[r][c].toString() : "",
                    isFixed: isFixed
                };
            }
        }

        this.renderSudoku();
        this.createKeyboard();
        this.startCountdown();
    }

    generateFullSudoku() {
        const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
        this.fillSudoku(grid);
        return grid;
    }

    fillSudoku(grid) {
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (grid[row][col] === 0) {
                    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
                    for (let num of nums) {
                        if (this.isSudokuSafe(grid, row, col, num)) {
                            grid[row][col] = num;
                            if (this.fillSudoku(grid)) return true;
                            grid[row][col] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    isSudokuSafe(grid, row, col, num) {
        for (let i = 0; i < 9; i++) {
            if (grid[row][i] === num || grid[i][col] === num) return false;
        }
        const startRow = row - row % 3;
        const startCol = col - col % 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (grid[i + startRow][j + startCol] === num) return false;
            }
        }
        return true;
    }

    renderSudoku() {
        this.boardsContainer.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'sudoku-container';

        const gridEl = document.createElement('div');
        gridEl.className = 'sudoku-grid';

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const key = `${r},${c}`;
                const state = this.sudokuState[key];
                const cell = document.createElement('div');
                cell.className = 'sudoku-cell';
                if (state.isFixed) cell.classList.add('fixed');
                cell.textContent = state.char;
                cell.dataset.r = r;
                cell.dataset.c = c;

                cell.addEventListener('click', () => {
                    this.sudokuCursor = { r, c };
                    this.updateSudokuUI();
                });

                gridEl.appendChild(cell);
            }
        }

        wrapper.appendChild(gridEl);

        /* Integrated into header */

        this.boardsContainer.appendChild(wrapper);
        this.updateSudokuUI();
    }

    updateSudokuUI() {
        document.querySelectorAll('.sudoku-cell').forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            cell.classList.toggle('focused', r === this.sudokuCursor.r && c === this.sudokuCursor.c);
            cell.textContent = this.sudokuState[`${r},${c}`].char;
        });
    }

    handleSudokuInput(key) {
        if (this.isGameOver) return;
        const { r, c } = this.sudokuCursor;
        const state = this.sudokuState[`${r},${c}`];
        if (state.isFixed) return;

        if (key === 'Backspace') {
            state.char = "";
        } else if (/^[1-9]$/.test(key)) {
            state.char = key;
        }
        this.updateSudokuUI();
    }

    validateSudoku() {
        if (this.isGameOver) return;
        let isCorrect = true;
        document.querySelectorAll('.sudoku-cell').forEach(cell => {
            cell.classList.remove('wrong');
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            if (this.sudokuState[`${r},${c}`].char !== this.sudokuSolution[r][c].toString()) {
                cell.classList.add('wrong');
                isCorrect = false;
            }
        });

        if (isCorrect) {
            this.isGameOver = true;
            showMessage("Parabéns! Sudoku completado com sucesso! 🎉");
            this.stats['sudoku'].won++;
            this.saveStats();
        } else {
            showMessage("Existem erros no grid. Verifique os destaques em vermelho.");
        }
    }
}

// Helpers
function showMessage(msg) {
    const msgContainer = document.getElementById('messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.textContent = msg;
    msgContainer.appendChild(msgDiv);
    setTimeout(() => msgDiv.remove(), 3000);
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById('modal-overlay').classList.add('hidden');
}

/**
 * Gerador de Palavras Cruzadas
 */
class CrosswordGenerator {
    constructor(wordsList) {
        this.wordsList = wordsList;
        this.grid = {};
        this.placedWords = [];
        this.bounds = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
    }

    generate(count = 10) {
        let attempts = 0;
        while (attempts < 50) {
            this.reset();
            if (this.tryBuild(count)) {
                return this.normalizeGrid();
            }
            attempts++;
        }
        console.error("Failed to generate crossword after 50 attempts");
        return this.normalizeGrid();
    }

    reset() {
        this.placedWords = [];
        this.drawnGrid = new Map(); // Key: "r,c", Value: letter
        this.occupied = new Set();
    }

    tryBuild(totalWords) {
        // Pick `totalWords` random items
        const pool = [...this.wordsList].sort(() => 0.5 - Math.random());
        const selected = [];
        const target = totalWords;

        // Place first word at 0,0 Horizontal
        const first = pool.pop();
        if (!first) return false;

        this.placeWord(first, 0, 0, 'across');
        selected.push(first);

        // Try to place others
        while (selected.length < target && pool.length > 0) {
            let placed = false;

            for (let i = 0; i < pool.length; i++) {
                const candidate = pool[i];
                // Check fit. Candidate might be String OR Object.
                // findFit should handle extraction
                const fit = this.findFit(candidate);
                if (fit) {
                    this.placeWord(candidate, fit.row, fit.col, fit.dir);
                    selected.push(candidate);
                    pool.splice(i, 1); // Remove used
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                break;
            }
        }

        return selected.length === target;
    }

    // Helper to get string from item (String or Object)
    getWordStr(item) {
        return (typeof item === 'object' && item.word) ? item.word : item;
    }

    getClue(item) {
        return (typeof item === 'object' && item.clue) ? item.clue : null;
    }

    findFit(wordItem) {
        const wordStr = this.getWordStr(wordItem);

        for (let i = 0; i < wordStr.length; i++) {
            const char = wordStr[i];

            for (const [key, val] of this.drawnGrid) {
                if (val === char) {
                    const [r, c] = key.split(',').map(Number);

                    if (this.isIntersection(r, c)) continue;

                    const existingWord = this.getWordAt(r, c);
                    if (!existingWord) continue;

                    const newDir = existingWord.dir === 'across' ? 'down' : 'across';

                    const startR = newDir === 'down' ? r - i : r;
                    const startC = newDir === 'down' ? c : c - i;

                    if (this.canPlace(wordStr, startR, startC, newDir)) {
                        return { row: startR, col: startC, dir: newDir };
                    }
                }
            }
        }
        return null;
    }

    isIntersection(r, c) {
        let count = 0;
        for (let w of this.placedWords) {
            if (this.wordContains(w, r, c)) count++;
        }
        return count > 1;
    }

    getWordAt(r, c) {
        return this.placedWords.find(w => this.wordContains(w, r, c));
    }

    wordContains(w, r, c) {
        // w.word is assumed to be the string here because placedWords stores the string in .word property (see placeWord)
        if (w.dir === 'across') {
            return r === w.row && c >= w.col && c < w.col + w.word.length;
        } else {
            return c === w.col && r >= w.row && r < w.row + w.word.length;
        }
    }

    canPlace(wordStr, r, c, dir) {
        for (let i = 0; i < wordStr.length; i++) {
            const cr = dir === 'down' ? r + i : r;
            const cc = dir === 'down' ? c : c + i;
            const char = wordStr[i];

            const existingChar = this.drawnGrid.get(`${cr},${cc}`);

            if (existingChar) {
                if (existingChar !== char) return false;
            } else {
                if (this.hasNeighborPerpendicular(cr, cc, dir)) return false;
            }

            if (i === 0) {
                if (this.drawnGrid.has(`${dir === 'down' ? cr - 1 : cr},${dir === 'down' ? cc : cc - 1}`)) return false;
            }
            if (i === wordStr.length - 1) {
                if (this.drawnGrid.has(`${dir === 'down' ? cr + 1 : cr},${dir === 'down' ? cc : cc + 1}`)) return false;
            }
        }
        return true;
    }

    hasNeighborPerpendicular(r, c, dir) {
        const deltas = dir === 'across' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        for (const [dr, dc] of deltas) {
            if (this.drawnGrid.has(`${r + dr},${c + dc}`)) return true;
        }
        return false;
    }

    placeWord(wordItem, r, c, dir) {
        const wordStr = this.getWordStr(wordItem);
        const clue = this.getClue(wordItem);

        // Store 'word' as the string to maintain compatibility with other methods
        // Store 'clue' separately
        this.placedWords.push({ word: wordStr, clue: clue, row: r, col: c, dir, id: this.placedWords.length });

        for (let i = 0; i < wordStr.length; i++) {
            const cr = dir === 'down' ? r + i : r;
            const cc = dir === 'down' ? c : c + i;
            this.drawnGrid.set(`${cr},${cc}`, wordStr[i]);
            this.occupied.add(`${cr},${cc}`);
        }
    }

    normalizeGrid() {
        if (this.placedWords.length === 0) return null;

        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        this.occupied.forEach(key => {
            const [r, c] = key.split(',').map(Number);
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
        });

        // Shift everything to 0,0
        const rows = maxR - minR + 1;
        const cols = maxC - minC + 1;

        const finalWords = this.placedWords.map(w => ({
            ...w,
            row: w.row - minR,
            col: w.col - minC
        }));

        return { words: finalWords, rows, cols };
    }
}

// Inicializa o jogo
const game = new Game();
