import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

// Release signing comes from keystore.properties (kept out of git): storeFile, storePassword, keyAlias, keyPassword.
val signing = Properties().apply { rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }

android {
  namespace = "top.qiao1.suiji"
  compileSdk = 35
  defaultConfig {
    applicationId = "top.qiao1.suiji"
    minSdk = 26
    targetSdk = 35
    manifestPlaceholders["cleartext"] = "false"
    versionCode = 3
    versionName = "1.8"
    buildConfigField("String", "HOME", "\"https://suiji-notes.vercel.app/\"")
  }
  buildFeatures { buildConfig = true }
  signingConfigs {
    if (signing.isNotEmpty()) create("release") {
      storeFile = rootProject.file(signing.getProperty("storeFile"))
      storePassword = signing.getProperty("storePassword")
      keyAlias = signing.getProperty("keyAlias")
      keyPassword = signing.getProperty("keyPassword")
    }
  }
  buildTypes {
    // A debug build opens the local dev server instead (adb reverse tcp:5174 tcp:5174), for trying page changes first.
    debug {
      applicationIdSuffix = ".debug"
      buildConfigField("String", "HOME", "\"http://localhost:5174/\"")
      manifestPlaceholders["cleartext"] = "true"
    }
    release {
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfigs.findByName("release")?.let { signingConfig = it }
    }
  }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  kotlinOptions { jvmTarget = "17" }
}
