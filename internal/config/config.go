package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port string
	Env  string
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

	return Config {
		Port: port,
		Env: env,
	}
}