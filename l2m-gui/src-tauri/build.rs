fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/macos_clipboard.m");
        cc::Build::new()
            .file("src/macos_clipboard.m")
            .compile("macos_clipboard");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }

    tauri_build::build();
}
