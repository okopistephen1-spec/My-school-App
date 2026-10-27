const API_BASE_URL = (
    document.querySelector('meta[name="api-base-url"]')?.content.trim()
    || window.location.origin
).replace(/\/+$/, "");

async function loadSongs() {
    const container = document.getElementById("songs-container");

    // Bottom music player elements
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

        playerTitle.textContent = song.title
            .replace(/\s*[\(\[]?(?:19|20)\d{2}[\)\]]?/g, "")
            .replace(/\s*[-|•]\s*.*$/, "")
            .trim();

        playerArtist.textContent = song.artist;

        audio.src = song.audio;
        audio.load();

        progressBar.value = 0;
        currentTime.textContent = "0:00";
        durationDisplay.textContent = "0:00";

        if (autoplay) {
            try {
                await audio.play();
            } catch (error) {
                console.error("Unable to play this track:", error);
                updatePlayButton();
            }
        }

        updatePlayButton();
    }

    // Load songs from the Flask API
    
try {
    container.textContent = "Loading songs...";

    const [jamendoResponse, audiusResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/jamendo/songs`),
        fetch(`${API_BASE_URL}/api/audius/songs`)
    ]);

    if (!jamendoResponse.ok || !audiusResponse.ok) {
        throw new Error("Failed to load songs from a music API");
    }

    const jamendoSongs = await jamendoResponse.json();
    const audiusSongs = await audiusResponse.json();

    songs = [...jamendoSongs, ...audiusSongs];

    container.innerHTML = "";


        if (songs.length === 0) {
            container.textContent = "No songs found.";
            return;
        }

        songs.forEach((song, index) => {
            const card = document.createElement("div");
            card.className = "song-card";

            const image = document.createElement("img");
            image.src = song.image || "";
            image.alt = `Artwork for ${song.title}`;
            image.className = "song-image";

            const title = document.createElement("h3");
            title.textContent = song.title;

            const artist = document.createElement("p");
            artist.textContent = song.artist;

            const playButton = document.createElement("button");
            playButton.className = "play-button";
            playButton.textContent = "▶ Play";

            playButton.addEventListener("click", () => {
                selectSong(index);
            });

            card.append(image, title, artist);
            container.appendChild(card);
        });

    } catch (error) {
        console.error(error);
        container.textContent =
            "Unable to load songs. Please try again later.";
    }

    // Bottom player controls
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

    // Update the progress display as the song plays
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

    // Allow users to seek through a track
    progressBar.addEventListener("input", () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime =
                (Number(progressBar.value) / 100) * audio.duration;
        }
    });
}

loadSongs();
