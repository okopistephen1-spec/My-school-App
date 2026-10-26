async function loadSongs() {
    const container = document.getElementById("songs-container");
    const searchInput = document.getElementById("search-input");
    const clearSearchButton = document.getElementById("clear-search");

    const audio = document.getElementById("main-audio");
    const playerImage = document.getElementById("player-image");
    const playerTitle = document.getElementById("player-title");
    const playerArtist = document.getElementById("player-artist");

    const playPauseButton = document.getElementById("play-pause-button");
    const previousButton = document.getElementById("previous-button");
    const nextButton = document.getElementById("next-button");

    const progressBar = document.getElementById("progress-bar");
    const currentTime = document.getElementById("current-time");
    const durationDisplay = document.getElementById("duration");

    let songs = [];
    let currentSongIndex = -1;

    function formatTime(seconds) {
        if (!Number.isFinite(seconds)) {
            return "0:00";
        }

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
    }

    function updatePlayButton() {
        if (!playPauseButton) return;
        playPauseButton.textContent = audio.paused ? "▶" : "⏸";
        playPauseButton.setAttribute(
            "aria-label",
            audio.paused ? "Play" : "Pause"
        );
    }

    function updateProgress() {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
            progressBar.value = 0;
            currentTime.textContent = "0:00";
            durationDisplay.textContent = "0:00";
            return;
        }

        progressBar.value = (audio.currentTime / audio.duration) * 100;
        currentTime.textContent = formatTime(audio.currentTime);
        durationDisplay.textContent = formatTime(audio.duration);
    }

    async function selectSong(index, autoplay = true) {
        if (index < 0 || index >= songs.length) {
            return;
        }

        currentSongIndex = index;
        const song = songs[index];

        playerImage.src = song.image || "";
        playerImage.alt = `Artwork for ${song.title}`;

        const cleanTitle = (song.title || "Untitled Track")
            .replace(/\s*[\(\[]?(?:19|20)\d{2}[\)\]]?/g, "")
            .replace(/\s*[-|•]\s*.*$/, "")
            .trim();

        playerTitle.textContent = cleanTitle || "Untitled Track";
        playerArtist.textContent = song.artist || "Unknown artist";

        audio.src = song.audio || "";
        audio.load();

        progressBar.value = 0;
        currentTime.textContent = "0:00";
        durationDisplay.textContent = "0:00";

        if (autoplay && song.audio) {
            try {
                await audio.play();
            } catch (error) {
                console.error("Unable to play this track:", error);
                updatePlayButton();
            }
        }

        updatePlayButton();
    }

    function renderSongs() {
        if (!container) return;

        const query = (searchInput ? searchInput.value : "").trim().toLowerCase();
        const visibleSongs = songs.filter((song) => {
            if (!query) return true;

            const haystack = [
                song.title,
                song.artist,
                song.genre,
                song.album
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return haystack.includes(query);
        });

        if (visibleSongs.length === 0) {
            container.innerHTML = '<p class="empty-state">No songs match your search.</p>';
            return;
        }

        container.innerHTML = "";

        visibleSongs.forEach((song) => {
            const row = document.createElement("article");
            row.className = "song-row";

            const art = document.createElement("div");
            art.className = "song-art";
            art.style.backgroundImage = `url('${song.image || "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=400&q=80"}')`;

            const meta = document.createElement("div");
            meta.className = "song-meta";

            const title = document.createElement("h4");
            title.textContent = song.title || "Untitled Track";

            const artist = document.createElement("p");
            artist.textContent = `${song.artist || "Unknown artist"} • ${song.genre || "Loose mix"}`;

            meta.append(title, artist);

            const action = document.createElement("button");
            action.type = "button";
            action.className = "song-play-button";
            action.textContent = "▶";
            action.setAttribute("aria-label", `Play ${song.title || "track"}`);
            action.addEventListener("click", () => {
                const songIndex = songs.findIndex((entry) => entry.id === song.id && entry.title === song.title);
                if (songIndex >= 0) {
                    selectSong(songIndex);
                }
            });

            row.append(art, meta, action);
            container.appendChild(row);
        });
    }

    try {
        container.innerHTML = '<p class="empty-state">Loading songs...</p>';

        const [jamendoResponse, audiusResponse] = await Promise.all([
            fetch("/api/jamendo/songs"),
            fetch("/api/audius/songs")
        ]);

        if (!jamendoResponse.ok || !audiusResponse.ok) {
            throw new Error("Failed to load songs from a music API");
        }

        const jamendoSongs = await jamendoResponse.json();
        const audiusSongs = await audiusResponse.json();

        songs = [...jamendoSongs, ...audiusSongs];

        if (songs.length === 0) {
            container.innerHTML = '<p class="empty-state">No songs found.</p>';
            return;
        }

        renderSongs();
    } catch (error) {
        console.error(error);
        container.innerHTML = '<p class="empty-state">Unable to load songs. Please try again later.</p>';
    }

    if (clearSearchButton && searchInput) {
        const syncClearState = () => {
            if (searchInput.value.trim().length > 0) {
                clearSearchButton.classList.remove("hidden");
            } else {
                clearSearchButton.classList.add("hidden");
            }
        };

        searchInput.addEventListener("input", () => {
            syncClearState();
            renderSongs();
        });

        clearSearchButton.addEventListener("click", () => {
            searchInput.value = "";
            clearSearchButton.classList.add("hidden");
            renderSongs();
            searchInput.focus();
        });
    }

    playPauseButton.addEventListener("click", async () => {
        if (currentSongIndex === -1) {
            if (songs.length > 0) {
                await selectSong(0);
            }
            return;
        }

        if (audio.paused) {
            try {
                await audio.play();
            } catch (error) {
                console.error("Unable to resume playback:", error);
            }
        } else {
            audio.pause();
        }

        updatePlayButton();
    });

    previousButton.addEventListener("click", () => {
        if (songs.length === 0) return;

        const previousIndex =
            currentSongIndex <= 0
                ? songs.length - 1
                : currentSongIndex - 1;

        selectSong(previousIndex);
    });

    nextButton.addEventListener("click", () => {
        if (songs.length === 0) return;

        const nextIndex =
            currentSongIndex >= songs.length - 1
                ? 0
                : currentSongIndex + 1;

        selectSong(nextIndex);
    });

    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("loadedmetadata", updateProgress);
    audio.addEventListener("play", updatePlayButton);
    audio.addEventListener("pause", updatePlayButton);
    audio.addEventListener("ended", () => {
        if (songs.length > 0) {
            const nextIndex = (currentSongIndex + 1) % songs.length;
            selectSong(nextIndex);
        }
    });

    progressBar.addEventListener("input", () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = (Number(progressBar.value) / 100) * audio.duration;
        }
    });
}

loadSongs();
