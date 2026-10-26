import sqlite3

def create_connection():
    connection = sqlite3.connect("smoothplays.db")

    return connection
connection = create_connection()
# print("Database connected successfully!")

connection.close()

def create_songs_table():
    connection = create_connection()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            genre TEXT,
            file_path TEXT NOT NULL
        )
    """)

    connection.commit()
    connection.close()

create_songs_table()
print("Songs table created successfully!")

def song_exists(title, artist, file_path):

    connection = create_connection()

    cursor = connection.execute(
        """
        SELECT id FROM songs
        WHERE title = ? AND artist = ? AND file_path = ?
        """,
        (title, artist, file_path)
    )

    song = cursor.fetchone()

    connection.close()

    return song is not None

def add_song(title, artist, genre, file_path):
    if song_exists(title, artist, file_path):
        print("This song already exists!")
        return

    connection = create_connection()

    connection.execute("""
        INSERT INTO songs (title, artist, genre, file_path)
        VALUES (?, ?, ?, ?)
    """, (title, artist, genre, file_path))

    connection.commit()
    connection.close()

    print("Song added successfully!")

def get_all_songs():

    connection = create_connection()

    cursor = connection.execute("SELECT * FROM songs")
    songs = cursor.fetchall()

    connection.close()

    return songs

songs = get_all_songs()

for song in songs:
    print(song)

def get_song_by_id(song_id):

    connection = create_connection()

    cursor = connection.execute(
        "SELECT * FROM songs WHERE id = ?",
        (song_id,)
    )

    song = cursor.fetchone()

    connection.close()

    return song

# # Test adding a song
# add_song(
#     "Calm Down",
#     "Rema",
#     "Afrobeats",
#     "static/songs/calm_down.mp3"
# )

# # Test retrieving all songs
# songs = get_all_songs()

# for song in songs:
#     print(song)

# # Test retrieving one song
# song = get_song_by_id(1)
# print(song)

def update_song(song_id, title, artist, genre, file_path):
    connection = create_connection()

    cursor = connection.execute(
        """
        UPDATE songs
        SET title = ?, artist = ?, genre = ?, file_path = ?
        WHERE id = ?
        """,
        (title, artist, genre, file_path, song_id)
    )

    connection.commit()

    updated = cursor.rowcount > 0

    connection.close()

    return updated

# result = update_song(
#     1,
#     "Calm Down",
#     "Rema",
#     "Afrobeats",
#     "static/songs/calm_down.mp3"
# )

# print(result)