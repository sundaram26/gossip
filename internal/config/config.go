package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port string
	Env  string
	DATABASE_URL string
}

func MustLoad() Config{
	godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		panic("Env is required")
	}

	env := os.Getenv("ENV")
	if env == "" {
		panic("Env is required")
	}

	db_url := os.Getenv("DATABASE_URL")
	if db_url == "" {
		panic("DATABASE_URL is required")
	}

	return Config {
		Port: port,
		Env: env,
		DATABASE_URL: db_url,
	}
}