use std::io;

fn main() {
    if let Err(error) = seria_config_service::run_stdio(io::stdin().lock(), io::stdout().lock()) {
        eprintln!("seria-config-service failed: {error}");
        std::process::exit(1);
    }
}
